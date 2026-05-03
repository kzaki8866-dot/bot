require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, StreamType } = require('@discordjs/voice');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const gtts = require('gtts');
const Groq = require('groq-sdk');
const express = require('express');
const Fuse = require('fuse.js'); // Advanced fuzzy indexing

const web = express();
web.get('/', (req, res) => res.send(`${process.env.BOT_NAME} is running.`));
web.listen(process.env.PORT || 10000, '0.0.0.0', () => console.log("🌐 Network active."));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const bot = new Client({ intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates ] });

const active_conversations = new Map();

// Database initialization
mongoose.model('User', new mongoose.Schema({ userId: String, username: String, lastSeen: Date }));
const MemoryBank = mongoose.model('Memory', new mongoose.Schema({ userId: String, fact: String, timestamp: { type: Date, default: Date.now } }));
mongoose.connect(process.env.MONGO_URI).then(() => console.log("🧠 DB Connected."));

// ==========================================
// DYNAMIC TOOL LOADER (The Repository)
// ==========================================
const toolsRegistry = new Map();
const agent_tools_definitions = [];

const toolFiles = fs.readdirSync(path.join(__dirname, 'tools')).filter(file => file.endsWith('.js'));
for (const file of toolFiles) {
    const tool = require(`./tools/${file}`);
    toolsRegistry.set(tool.definition.function.name, tool);
    agent_tools_definitions.push(tool.definition);
}
console.log(`Loaded ${toolsRegistry.size} dynamic skills.`);

// ==========================================
// EVENT LISTENER
// ==========================================
bot.on(Events.MessageCreate, async msg => {
    if (msg.author.bot || msg.content.length > 500) return;
    const is_pinged = msg.mentions.users.has(bot.user.id);
    if (!is_pinged && Math.random() > 0.05) return;

    await msg.channel.sendTyping();

    try {
        const UserProfile = mongoose.model('User');
        await UserProfile.findOneAndUpdate({ userId: msg.author.id }, { username: msg.author.username, lastSeen: new Date() }, { upsert: true });

        // Advanced Fuzzy Indexing for Memories
        const all_memories = await MemoryBank.find({ userId: msg.author.id });
        const fuse = new Fuse(all_memories, { keys: ['fact'], threshold: 0.6 });
        // It searches its own memory for keywords related to the user's current message
        const relevant_memories = fuse.search(msg.content).map(res => res.item.fact).slice(0, 5);
        
        const memory_context = relevant_memories.length > 0 ? `\nContext regarding user: ${relevant_memories.join(' | ')}` : '';

        const system_prompt = `Identity: You are ${process.env.BOT_NAME}. ${process.env.BOT_PERSONA}
CRITICAL: You are equipped with dynamic background tools. NEVER type out JSON, XML, or <function> tags in your responses. Speak naturally.${memory_context}`;

        if (!active_conversations.has(msg.author.id)) active_conversations.set(msg.author.id, []);
        let chat_history = active_conversations.get(msg.author.id);
        chat_history.push({ role: "user", content: msg.content });
        if (chat_history.length > 15) chat_history.shift();

        let current_messages = [ { role: "system", content: system_prompt }, ...chat_history ];
        let files_to_send = [];

        // Reasoning Engine
        let response = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: current_messages,
            tools: agent_tools_definitions,
            tool_choice: "auto",
            parallel_tool_calls: false
        });

        let ai_reply = response.choices[0].message;

        // Dynamic Tool Execution
        if (ai_reply.tool_calls) {
            current_messages.push(ai_reply);

            for (const tool_call of ai_reply.tool_calls) {
                const args = JSON.parse(tool_call.function.arguments);
                const toolName = tool_call.function.name;
                
                let tool_result = "Tool executed.";
                if (toolsRegistry.has(toolName)) {
                    const toolModule = toolsRegistry.get(toolName);
                    // Pass dynamic context objects to the tool
                    tool_result = await toolModule.execute(args, msg.author.id, { files_to_send, msg });
                }

                current_messages.push({ role: "tool", tool_call_id: tool_call.id, content: tool_result });
            }

            response = await groq.chat.completions.create({ model: "llama-3.3-70b-versatile", messages: current_messages });
            ai_reply = response.choices[0].message;
        }

        // Output Scrubber
        let final_text = ai_reply.content || "";
        final_text = final_text.replace(/<function[\s\S]*?<\/function>/g, '').replace(/<function[\s\S]*?>/g, '').replace(/"""/g, '').trim();

        if (final_text.length > 0 || files_to_send.length > 0) {
            chat_history.push({ role: "assistant", content: final_text || "*sent an image*" });
            await msg.reply({ content: final_text || null, files: files_to_send });

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
        console.error("Agent Error:", err);
    }
});

bot.login(process.env.TOKEN);