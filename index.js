require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, StreamType } = require('@discordjs/voice');
const mongoose = require('mongoose');
const gtts = require('gtts');
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');
const express = require('express');

// --- KEEP ALIVE ---
const web = express();
web.get('/', (req, res) => res.send(`${process.env.BOT_NAME} is alive.`));
web.listen(process.env.PORT || 10000, '0.0.0.0', () => console.log("Web server running."));

// --- SETUP ---
const ai = new Groq({ apiKey: process.env.GROQ_API_KEY });
const bot = new Client({ 
    intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates ] 
});

const chat_history = new Map();

// --- DATABASE (The Infinite Brain) ---
const UserProfile = mongoose.model('UserProfile', new mongoose.Schema({
    userId: String,
    username: String,
    tier: { type: String, default: "user" }, 
    memories: { type: Map, of: String, default: {} } // Upgraded to a dictionary/map for smarter storage
}));
mongoose.connect(process.env.MONGO_URI).then(() => console.log("Memory core online."));

// --- THE AI'S TOOLBOX (Function Calling) ---
// This is the secret sauce. We give the AI these tools, and IT decides when to use them.
const ai_tools = [
    {
        type: "function",
        function: {
            name: "save_memory",
            description: "Save an important fact about the user to remember forever.",
            parameters: {
                type: "object",
                properties: {
                    topic: { type: "string", description: "What the fact is about (e.g., 'favorite_food', 'dogs_name', 'hometown')" },
                    fact: { type: "string", description: "The actual fact to remember" }
                },
                required: ["topic", "fact"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "join_voice_chat",
            description: "Join the user's voice channel if they ask you to hang out or speak.",
            parameters: { type: "object", properties: {} }
        }
    }
];

bot.on(Events.MessageCreate, async msg => {
    if (msg.author.bot) return;
    if (msg.content.length > 400) return; // Security 

    const is_pinged = msg.mentions.users.has(bot.user.id);
    if (!is_pinged && Math.random() > 0.05) return;

    await msg.channel.sendTyping();

    try {
        let person = await UserProfile.findOne({ userId: msg.author.id }) || await UserProfile.create({ userId: msg.author.id, username: msg.author.username });

        // Format memories dynamically
        let known_facts = [];
        person.memories.forEach((value, key) => known_facts.push(`${key}: ${value}`));
        const memory_string = known_facts.length > 0 ? `\n\nThings you know about them:\n${known_facts.join('\n')}` : '';

        // Extremely clean, dynamic system prompt pulled from .env
        const system_instruction = `You are ${process.env.BOT_NAME}. ${process.env.BOT_VIBE}
Keep responses natural and short (1-2 sentences). You have tools to save memories and join voice channels. Use them naturally when it makes sense. ${memory_string}`;

        // Short-term memory logic
        if (!chat_history.has(msg.author.id)) chat_history.set(msg.author.id, []);
        let recent_chat = chat_history.get(msg.author.id);
        recent_chat.push({ role: "user", content: msg.content });
        if (recent_chat.length > 15) recent_chat.shift(); 

        // --- PING THE AI WITH TOOLS ---
        const response = await ai.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [ { role: "system", content: system_instruction }, ...recent_chat ],
            tools: ai_tools,
            tool_choice: "auto" // The AI chooses whether to talk, use a tool, or both
        });

        const ai_message = response.choices[0].message;

        // --- EXECUTE TOOLS IF THE AI CHOSE TO USE THEM ---
        if (ai_message.tool_calls) {
            for (const tool of ai_message.tool_calls) {
                const args = JSON.parse(tool.function.arguments);
                
                if (tool.function.name === 'save_memory') {
                    // The AI decided to learn something!
                    person.memories.set(args.topic, args.fact);
                    await person.save();
                    console.log(`[LEARNED] ${person.username}'s ${args.topic}: ${args.fact}`);
                }
                
                if (tool.function.name === 'join_voice_chat') {
                    // The AI decided to join voice!
                    const vc = msg.member?.voice?.channel;
                    if (vc) joinVoiceChannel({ channelId: vc.id, guildId: msg.guild.id, adapterCreator: msg.guild.voiceAdapterCreator });
                }
            }
        }

        // --- SEND TEXT AND VOICE ---
        if (ai_message.content) {
            recent_chat.push({ role: "assistant", content: ai_message.content });
            await msg.reply(ai_message.content);

            const connection = getVoiceConnection(msg.guild.id);
            if (connection) {
                let clean_text = ai_message.content.replace(/[\u{1F600}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
                const tts = new gtts(clean_text, 'en');
                const file_name = path.join(__dirname, `v_${msg.id}.mp3`);
                
                tts.save(file_name, () => {
                    const player = createAudioPlayer();
                    connection.subscribe(player);
                    player.play(createAudioResource(fs.createReadStream(file_name), { inputType: StreamType.Arbitrary }));
                    setTimeout(() => { if (fs.existsSync(file_name)) fs.unlinkSync(file_name); }, 20000);
                });
            }
        }

    } catch (err) {
        console.error("Agent Engine Error:", err);
    }
});

bot.login(process.env.TOKEN);