require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, VoiceConnectionStatus, entersState, getVoiceConnection } = require('@discordjs/voice');
const mongoose = require('mongoose');
const googleTTS = require('google-tts-api');
const Groq = require('groq-sdk');
const express = require('express');

// --- KEEP ALIVE SERVER ---
const app = express();
app.get('/', (req, res) => res.send('dollhouse neural link: ONLINE 🎀'));
app.listen(process.env.PORT || 10000);

// --- DB SCHEMA ---
const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    username: String,
    tier: { type: String, default: "stranger" }, 
    trustLevel: { type: Number, default: 0 },
    memoryVault: { type: Array, default: [] }
}));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildVoiceStates 
    ] 
});

const SYSTEM_PROMPT = `you are a shy, vulgar teen comgirl. lowercase only. use stutters. MAX 1 SENTENCE.
ALWAYS keep these tags hidden and at the end of your message:
[JOIN_VC] - join voice if they ask.
[TRUST: +/-X] - update trust points.
[TIER: status] - update relationship (bestie, bf, hater, enemy).
[SAVE: fact] - save a memory.
[IMAGE: prompt] - send a picture.`;

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("🧠 DATABASE CONNECTED"))
    .catch(err => console.error("❌ DB ERROR:", err));

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // --- MANUAL SUMMON ---
    const content = message.content.toLowerCase();
    if (content === 'come here' || content === 'join vc') {
        const channel = message.member.voice.channel;
        if (!channel) return message.reply("get in a vc first.. 🐾");
        
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
        });

        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 5000);
            return message.reply("m-mm.. i'm here..");
        } catch (e) {
            return message.reply("i can't join.. check perms..");
        }
    }

    // --- AI CHAT LOGIC ---
    if (!message.mentions.has(client.user) && Math.random() > 0.15) return;

    await message.channel.sendTyping();

    try {
        let userData = await User.findOne({ userId: message.author.id }) || await User.create({ userId: message.author.id, username: message.author.username });

        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: "system", content: `${SYSTEM_PROMPT} \nUser: ${userData.username} | Tier: ${userData.tier} | Trust: ${userData.trustLevel} \nMemories: ${userData.memoryVault.join(', ')}` }, { role: "user", content: message.content }],
            model: "llama-3.1-8b-instant",
        });

        let rawOutput = chatCompletion.choices[0].message.content.toLowerCase();
        
        // AI Voice Join
        if (rawOutput.includes('[join_vc]')) {
            const vc = message.member.voice.channel;
            if (vc) joinVoiceChannel({ channelId: vc.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
        }

        // DB Updates
        const trustMatch = rawOutput.match(/\[trust: ([+-]\d+)\]/);
        if (trustMatch) userData.trustLevel += parseInt(trustMatch[1]);
        const tierMatch = rawOutput.match(/\[tier: (.*?)\]/);
        if (tierMatch) userData.tier = tierMatch[1];
        const saveMatch = rawOutput.match(/\[save: (.*?)\]/);
        if (saveMatch) userData.memoryVault.push(saveMatch[1]);
        await userData.save();

        // Clean Display
        let displayContent = rawOutput.replace(/\[.*?\]/g, '').trim();

        // Images
        let files = [];
        if (rawOutput.includes('[image:')) {
            const img = rawOutput.match(/\[image: (.*?)\]/)?.[1];
            files.push(`https://pollinations.ai/p/${encodeURIComponent(img)}?width=1024&height=1024&seed=${Math.random()}`);
        }

        await message.reply({ content: displayContent || 'm-mm..', files: files });

        // TTS Playback
        const connection = getVoiceConnection(message.guild.id);
        if (connection && displayContent) {
            const url = googleTTS.getAudioUrl(displayContent, { lang: 'en', slow: false });
            const player = createAudioPlayer();
            connection.subscribe(player);
            player.play(createAudioResource(url));
        }
    } catch (e) { console.error("AI Error:", e); }
});

client.once('ready', () => console.log(`✅ ${client.user.tag} IS READY`));
client.login(process.env.TOKEN);