require('dotenv').config();
const { Client, GatewayIntentBits, Events, AttachmentBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, StreamType } = require('@discordjs/voice');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const gtts = require('gtts');
const Groq = require('groq-sdk');
const express = require('express');

// --- SERVER LIFELINE ---
const web = express();
web.get('/', (req, res) => res.send(`Agent ${process.env.BOT_NAME} is online.`));
web.listen(process.env.PORT || 10000, '0.0.0.0', () => console.log("🌐 Network active."));

// --- CORE SYSTEMS ---
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const bot = new Client({ 
    intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates ] 
});

const active_conversations = new Map();

// --- RELATIONAL MEMORY DATABASE (RAG) ---
// Instead of a simple array, we use a dedicated collection for memories so it can scale infinitely.
const UserProfile = mongoose.model('User', new mongoose.Schema({
    userId: String,
    username: String,
    trustLevel: { type: Number, default: 0 },
    lastSeen: Date
}));

const MemoryBank = mongoose.model('Memory', new mongoose.Schema({
    userId: String,
    fact: String,
    timestamp: { type: Date, default: Date.now }
}));

mongoose.connect(process.env.MONGO_URI).then(() => console.log("🧠 Relational Memory Core Online."));

// --- THE AGENT'S AUTONOMOUS TOOLBOX ---
const agent_tools = [
    {
        type: "function",
        function: {
            name: "commit_to_memory",
            description: "Save a permanent memory about the user. Use this whenever they state a preference, life event, or fact about themselves.",
            parameters: { type: "object", properties: { fact: { type: "string", description: "The specific fact to remember (e.g., 'Has a dog named Max', 'Lives in Poland')" } }, required: ["fact"] }
        }
    },
    {
        type: "function",
        function: {
            name: "generate_and_send_image",
            description: "Generate a picture and send it to the user. Use this if they ask to see something, or if you want to visually show them a concept.",
            parameters: { type: "object", properties: { image_prompt: { type: "string", description: "A highly detailed visual description of what to generate." } }, required: ["image_prompt"] }
        }
    },
    {
        type: "function",
        function: {
            name: "join_voice_channel",
            description: "Connect to the user's voice channel.",
            parameters: { type: "object", properties: {} }
        }
    }
];

bot.on(Events.MessageCreate, async msg => {
    if (msg.author.bot || msg.content.length > 500) return;

    const is_pinged = msg.mentions.users.has(bot.user.id);
    if (!is_pinged && Math.random() > 0.05) return;

    await msg.channel.sendTyping();

    try {
        // 1. Fetch User Profile
        let user = await UserProfile.findOneAndUpdate(
            { userId: msg.author.id }, 
            { username: msg.author.username, lastSeen: new Date() }, 
            { upsert: true, new: true }
        );

        // 2. Retrieve Past Memories (RAG implementation)
        // Fetches the 10 most recent memories about this specific user
        const past_memories = await MemoryBank.find({ userId: msg.author.id }).sort({ timestamp: -1 }).limit(10);
        const memory_context = past_memories.length > 0 
            ? `\n\n[YOUR MEMORY BANK FOR THIS USER]:\n${past_memories.map(m => `- ${m.fact}`).join('\n')}` 
            : '';

        // 3. Dynamic Identity
        const system_prompt = `Identity: You are ${process.env.BOT_NAME}. ${process.env.BOT_PERSONA}\n${memory_context}`;

        // 4. Conversation History Management
        if (!active_conversations.has(msg.author.id)) active_conversations.set(msg.author.id, []);
        let chat_history = active_conversations.get(msg.author.id);
        
        chat_history.push({ role: "user", content: `"""${msg.content}"""` });
        if (chat_history.length > 15) chat_history.shift();

        // ==========================================
        // THE REASONING LOOP
        // ==========================================
        let current_messages = [ { role: "system", content: system_prompt }, ...chat_history ];
        
        // Pass 1: The AI thinks and decides if it needs a tool
        let response = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: current_messages,
            tools: agent_tools,
            tool_choice: "auto"
        });

        let ai_reply = response.choices[0].message;
        let files_to_send = [];

        // Pass 2: Execute Tools
        if (ai_reply.tool_calls) {
            current_messages.push(ai_reply); // Save the tool call to history

            for (const tool of ai_reply.tool_calls) {
                const args = JSON.parse(tool.function.arguments);
                let tool_result = "";

                if (tool.function.name === 'commit_to_memory') {
                    await MemoryBank.create({ userId: msg.author.id, fact: args.fact });
                    tool_result = `Successfully saved memory: ${args.fact}`;
                    console.log(`[SYNAPSE] Learned about ${user.username}: ${args.fact}`);
                }
                
                if (tool.function.name === 'generate_and_send_image') {
                    const url = `https://pollinations.ai/p/${encodeURIComponent(args.image_prompt)}?width=1024&height=1024&nologo=true`;
                    files_to_send.push(new AttachmentBuilder(url, { name: 'vision.jpg' }));
                    tool_result = `Image successfully generated and sent to user.`;
                    console.log(`[VISION] Generated image for ${user.username}`);
                }

                if (tool.function.name === 'join_voice_channel') {
                    const vc = msg.member?.voice?.channel;
                    if (vc) {
                        joinVoiceChannel({ channelId: vc.id, guildId: msg.guild.id, adapterCreator: msg.guild.voiceAdapterCreator });
                        tool_result = `Successfully joined the voice channel.`;
                    } else {
                        tool_result = `Failed: User is not in a voice channel.`;
                    }
                }

                // Feed the tool result back to the AI
                current_messages.push({ role: "tool", tool_call_id: tool.id, content: tool_result });
            }

            // Pass 3: The AI looks at the tool results and formulates a final text reply
            response = await groq.chat.completions.create({
                model: "llama-3.3-70b-versatile",
                messages: current_messages
            });
            
            ai_reply = response.choices[0].message;
        }

        // ==========================================
        // FINAL EXECUTION
        // ==========================================
        if (ai_reply.content || files_to_send.length > 0) {
            chat_history.push({ role: "assistant", content: ai_reply.content || "*sent an image*" });
            
            // Clean AI formatting quirks
            const final_text = ai_reply.content ? ai_reply.content.replace(/"""/g, '').trim() : '';
            
            await msg.reply({ content: final_text || null, files: files_to_send });

            // Voice synthesis logic
            const vc_conn = getVoiceConnection(msg.guild.id);
            if (vc_conn && final_text) {
                const clean_audio = final_text.replace(/[\u{1F600}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
                const tts = new gtts(clean_audio, 'en');
                const file_path = path.join(__dirname, `v_${msg.id}.mp3`);
                
                tts.save(file_path, () => {
                    const player = createAudioPlayer();
                    vc_conn.subscribe(player);
                    player.play(createAudioResource(fs.createReadStream(file_path), { inputType: StreamType.Arbitrary }));
                    setTimeout(() => { if (fs.existsSync(file_path)) fs.unlinkSync(file_path); }, 20000);
                });
            }
        }
    } catch (err) {
        console.error("Agent System Failure:", err);
    }
});

bot.login(process.env.TOKEN);