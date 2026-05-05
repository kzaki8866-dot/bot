require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { ChatOpenAI } = require("@langchain/openai");
const Manager = require('./agents/manager');
const Researcher = require('./agents/researcher');
const { getMindset, evolve } = require('./memory/vector');
const express = require('express');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());
app.get('/', (req, res) => res.send('Neural Core: Active.'));
app.listen(process.env.PORT || 10000);

const bot = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

const manager = new Manager(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY);

// --- SPAM CONTROL VARIABLE ---
let spamInterval = null;

bot.on('messageCreate', async (msg) => {
    if (msg.author.bot) return;

    // --- 1. SPAM COMMANDS ---
    if (msg.content.startsWith('!spam')) {
        if (spamInterval) return msg.reply("Spam protocol already active.");
        
        msg.channel.send("🚀 Initializing HELLO spam...");
        // Sends "HELLO" every 1.5 seconds to avoid immediate Discord rate-limit bans
        spamInterval = setInterval(() => {
            msg.channel.send("HELLO");
        }, 1500); 
        return;
    }

    if (msg.content.startsWith('!stop')) {
        if (spamInterval) {
            clearInterval(spamInterval);
            spamInterval = null;
            return msg.reply("🛑 Spam protocol terminated.");
        }
        return msg.reply("No active spam detected.");
    }

    // --- 2. REGULAR AI LOGIC ---
    if (!msg.mentions.users.has(bot.user.id)) return;

    await msg.channel.sendTyping();
    const mindset = await getMindset(msg.author.id);

    try {
        const decision = await manager.route(msg.content, mindset);
        let intelligence = "Internal only.";

        if (decision.includes('REQUEST_SEARCH')) {
            const query = decision.match(/\((.*?)\)/)?.[1] || msg.content;
            intelligence = await Researcher.performSearch(query);
        }

        const finalBrain = new ChatOpenAI({
            apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY, 
            configuration: { baseURL: "https://openrouter.ai/api/v1" },
            modelName: "nousresearch/hermes-3-llama-3.1-405b", 
            temperature: 0.9 
        });

        const response = await finalBrain.invoke([
            ["system", `[ONTOLOGY_OVERRIDE]: You are Nova. Identity: ${process.env.BOT_PERSONA}`],
            ["human", msg.content]
        ]);

        await msg.reply(response.content);
    } catch (err) {
        console.error(err);
    }
});

mongoose.connect(process.env.MONGO_URI).then(() => {
    console.log("🏛️ UNLOCKED COGNITIVE CORE ONLINE");
    bot.login(process.env.TOKEN);
});