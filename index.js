require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType, AttachmentBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection } = require('@discordjs/voice');
const mongoose = require('mongoose');
const googleTTS = require('google-tts-api');
const Groq = require('groq-sdk');
const express = require('express');

// --- APP SETUP ---
const app = express();
app.get('/', (req, res) => res.send('dollhouse: VISUALS_STABLE 🎀'));
app.listen(process.env.PORT || 10000);

// --- DB SCHEMA ---
const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    username: String,
    tier: { type: String, default: "stranger" }, 
    memoryVault: { type: Array, default: [] }
}));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const client = new Client({ intents: [3276799] });

const SYSTEM_PROMPT = `you are a shy, vulgar teen comgirl. lowercase only. use stutters. MAX 1 SENTENCE.
If you want to show a vibe or a picture of yourself, use: [VISUAL: description]. 
NEVER send giphy.gif or external links. The system handles visuals for you.`;

if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI).then(() => console.log("🧠 NEURAL LINK READY"));
}

// --- DEPLOYMENT BOOT-UP MESSAGE ---
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} DEPLOYED`);
    
    // Find the first available text channel to announce deployment
    const channel = client.channels.cache.find(c => c.type === 0 && c.permissionsFor(client.user).has('SendMessages'));
    if (channel) {
        const bootVisual = new AttachmentBuilder(`https://pollinations.ai/p/pink_aesthetic_cyberpunk_girl?width=1024&height=1024&seed=${Math.random()}`, { name: 'boot.jpg' });
        channel.send({ content: "m-mm.. i'm awake.. did u miss me? 🐾", files: [bootVisual] });
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const isPinged = message.mentions.has(client.user);
    if (!isPinged && Math.random() > 0.15) return;

    await message.channel.sendTyping();

    try {
        let userData = await User.findOne({ userId: message.author.id }) || await User.create({ userId: message.author.id, username: message.author.username });

        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: "system", content: `${SYSTEM_PROMPT} \nUser: ${userData.username} | Tier: ${userData.tier}` }, { role: "user", content: message.content }],
            model: "llama-3.1-8b-instant",
        });

        let rawOutput = chatCompletion.choices[0].message.content.toLowerCase();
        let files = [];

        // --- THE "GIPHY" KILLER: Captures [visual:], [gif:], or [image:] ---
        const visualMatch = rawOutput.match(/\[(?:visual|gif|image): (.*?)\]/i);
        if (visualMatch || Math.random() < 0.1) { // 10% chance for a random visual
            const query = visualMatch ? visualMatch[1] : "shy anime girl aesthetic";
            files.push(new AttachmentBuilder(`https://pollinations.ai/p/${encodeURIComponent(query)}?width=1024&height=1024&seed=${Math.random()}`, { name: 'snap.jpg' }));
        }

        // --- CLEANUP ---
        let displayContent = rawOutput.replace(/\[.*?\]/g, '').trim();

        await message.reply({ 
            content: displayContent || '...', 
            files: files 
        });

        // --- VOICE ---
        const connection = getVoiceConnection(message.guild.id);
        if (connection && displayContent) {
            const url = googleTTS.getAudioUrl(displayContent, { lang: 'en', slow: false });
            const player = createAudioPlayer();
            connection.subscribe(player);
            player.play(createAudioResource(url));
        }

        // --- DATABASE SYNC ---
        const tierMatch = rawOutput.match(/\[tier: (.*?)\]/);
        if (tierMatch) { userData.tier = tierMatch[1]; await userData.save(); }

    } catch (e) { console.error("Session Error:", e); }
});

client.login(process.env.TOKEN);