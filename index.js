require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { ChatGroq } = require("@langchain/groq");
const Manager = require('./agents/manager');
const Researcher = require('./agents/researcher');
const { getMindset, evolve } = require('./memory/vector');
const mongoose = require('mongoose');
const express = require('express');

// --- RENDER PORT BINDING ---
const app = express();
app.get('/', (req, res) => res.send('Neural Core Heartbeat: Stable.'));
app.listen(process.env.PORT || 10000, () => console.log("📡 Heartbeat Signal Active."));

// --- DISCORD CLIENT ---
const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// --- AGENT INITIALIZATION ---
const manager = new Manager(process.env.GROQ_API_KEY);

bot.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.mentions.users.has(bot.user.id)) return;

    await msg.channel.sendTyping();
    const mindset = await getMindset(msg.author.id);

    try {
        // 1. Manager decides the strategy
        const decision = await manager.route(msg.content, mindset);
        let extraIntelligence = "";

        // 2. Researcher gathers external data if requested
        if (decision.includes('REQUEST_SEARCH')) {
            const query = decision.match(/\((.*?)\)/)?.[1] || msg.content;
            extraIntelligence = await Researcher.performSearch(query);
        }

        // 3. Final Synthesis (The Government AI Mind)
        const finalBrain = new ChatGroq({ 
            apiKey: process.env.GROQ_API_KEY, 
            modelName: "llama-3.3-70b-versatile",
            model: "llama-3.3-70b-versatile" 
        });

        const response = await finalBrain.invoke([
            ["system", `You are Nova. ${process.env.BOT_PERSONA}\n\nMINDSET: ${mindset}\nRESEARCH: ${extraIntelligence}`],
            ["human", msg.content]
        ]);

        // 4. Autonomous Evolution (Self-Learning)
        const learning = await finalBrain.invoke([
            ["system", "Analyze user interaction. Output exactly two lines:\nLine 1: One specific fact learned.\nLine 2: A new 1-sentence description of this user's current identity/vibe."],
            ["human", `User: ${msg.content}\nAI: ${response.content}`]
        ]);
        
        const lines = learning.content.split('\n').filter(l => l.trim() !== "");
        if (lines.length >= 2) {
            await evolve(msg.author.id, lines[0], lines[1]);
        }

        await msg.reply(response.content);

    } catch (err) {
        console.error("Neural Loop Error:", err);
        await msg.reply("Neural pathway disruption. Resetting logic.");
    }
});

mongoose.connect(process.env.MONGO_URI).then(() => {
    console.log("🏛️ COGNITIVE ARCHITECTURE FULLY LOADED");
    bot.login(process.env.TOKEN);
});