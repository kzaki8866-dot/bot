require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { ChatGroq } = require("@langchain/groq");
const Manager = require('./agents/manager');
const Researcher = require('./agents/researcher');
const { getMindset, evolve } = require('./memory/vector');
const mongoose = require('mongoose');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('Neural Core Heartbeat: Stable.'));
app.listen(process.env.PORT || 10000);

const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const manager = new Manager(process.env.GROQ_API_KEY);

bot.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.mentions.users.has(bot.user.id)) return;

    await msg.channel.sendTyping();
    const mindset = await getMindset(msg.author.id);

    try {
        const decision = await manager.route(msg.content, mindset);
        let extraIntelligence = "No search performed.";

        if (decision.includes('REQUEST_SEARCH')) {
            // Clean the query from the Manager's output
            const query = decision.match(/\((.*?)\)/)?.[1] || msg.content;
            extraIntelligence = await Researcher.performSearch(query);
        }

        const finalBrain = new ChatGroq({ 
            apiKey: process.env.GROQ_API_KEY, 
            modelName: "llama-3.3-70b-versatile",
            model: "llama-3.3-70b-versatile",
            temperature: 0.7 
        });

        // The "Synthesis" prompt - this is what makes her smart
        const response = await finalBrain.invoke([
            ["system", `You are Nova. ${process.env.BOT_PERSONA}
             
             INTERNAL DATABASE:
             ${mindset}

             LIVE RESEARCH DATA:
             ${extraIntelligence}

             INSTRUCTION: Use the LIVE RESEARCH DATA to answer accurately. If the research contains a price or fact, state it clearly. Never say 'I don't know' if the research data is provided above.`],
            ["human", msg.content]
        ]);

        // Learning loop
        const learning = await finalBrain.invoke([
            ["system", "In 2 lines: 1. A new fact learned. 2. Current user vibe."],
            ["human", `User: ${msg.content}\nResponse: ${response.content}`]
        ]);
        
        const [fact, identity] = learning.content.split('\n');
        await evolve(msg.author.id, fact || "Interaction logged", identity || "Active");

        await msg.reply(response.content);

    } catch (err) {
        console.error("Neural Error:", err);
        await msg.reply("Neural disruption occurred.");
    }
});

mongoose.connect(process.env.MONGO_URI).then(() => {
    console.log("🏛️ COGNITIVE ARCHITECTURE FULLY LOADED");
    bot.login(process.env.TOKEN);
});