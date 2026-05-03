require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const Manager = require('./agents/manager');
const Researcher = require('./agents/researcher');
const { getMindset, evolve } = require('./memory/vector');
const mongoose = require('mongoose');

const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const manager = new Manager(process.env.GROQ_API_KEY);

bot.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.mentions.users.has(bot.user.id)) return;

    await msg.channel.sendTyping();
    const mindset = await getMindset(msg.author.id);

    // 1. Manager decides the path
    const decision = await manager.route(msg.content, mindset);
    let extraIntelligence = "";

    // 2. Researcher steps in only if needed
    if (decision.includes('REQUEST_SEARCH')) {
        const query = decision.match(/\((.*?)\)/)[1];
        extraIntelligence = await Researcher.performSearch(query);
    }

    // 3. Final Synthesis (The "Government AI" response)
    const finalBrain = new (require("@langchain/groq").ChatGroq)({ 
        apiKey: process.env.GROQ_API_KEY, 
        modelName: "llama-3.3-70b-versatile" 
    });

    const response = await finalBrain.invoke([
        ["system", `You are Nova. ${process.env.BOT_PERSONA}\n\nMINDSET: ${mindset}\nRESEARCH: ${extraIntelligence}`],
        ["human", msg.content]
    ]);

    // 4. Autonomous Evolution (Learning)
    const learning = await finalBrain.invoke([
        ["system", "Analyze user interaction. Line 1: New Fact. Line 2: Updated User Identity."],
        ["human", `User: ${msg.content}\nAI: ${response.content}`]
    ]);
    const [fact, identity] = learning.content.split('\n');
    await evolve(msg.author.id, fact, identity);

    await msg.reply(response.content);
});

mongoose.connect(process.env.MONGO_URI).then(() => {
    console.log("🏛️ COGNITIVE ARCHITECTURE FULLY LOADED");
    bot.login(process.env.TOKEN);
});