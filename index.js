require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, NoSubscriberBehavior, StreamType, getVoiceConnection } = require('@discordjs/voice');
const mongoose = require('mongoose');
const edgeTTS = require('edge-tts'); // Natural & Free
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('dollhouse is open 🎀'));
app.listen(process.env.PORT || 10000);

// --- SUPER ADVANCED DATABASE ---
const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    username: String,
    tier: { type: String, default: "stranger" }, 
    trustLevel: { type: Number, default: 0 },
    moodTowardsUser: { type: String, default: "neutral" },
    memoryVault: { type: Array, default: [] },
    lastInteraction: { type: Date, default: Date.now }
}));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const client = new Client({ intents: [3276799] });

const SYSTEM_PROMPT = `you are a shy, vulgar teen comgirl. lowercase only. use stutters. MAX 1 SENTENCE.
NEVER type 'memory log' or 'command tag'. 
HIDDEN TAGS: [JOIN_VC], [TRUST: +/-X], [TIER: status], [MOOD: mood], [SAVE: fact], [IMAGE: prompt], [GIF: keyword]`;

if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI).then(() => console.log("🧠 DB CONNECTED"));
}

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const isPinged = message.mentions.has(client.user);
    if (!isPinged && Math.random() > 0.15) return;

    await message.channel.sendTyping();

    try {
        let userData = await User.findOne({ userId: message.author.id }) || await User.create({ userId: message.author.id, username: message.author.username });

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: `${SYSTEM_PROMPT} \nStatus: ${userData.tier} | Trust: ${userData.trustLevel} | Mood: ${userData.moodTowardsUser} \nMemories: ${userData.memoryVault.join(', ')}` },
                { role: "user", content: message.content }
            ],
            model: "llama-3.1-8b-instant",
        });

        let rawOutput = chatCompletion.choices[0].message.content.toLowerCase();
        let displayContent = rawOutput;

        // 1. PROCESS VC JOIN (AI DETECTED)
        if (rawOutput.includes('[join_vc]')) {
            const vc = message.member.voice.channel;
            if (vc) joinVoiceChannel({ channelId: vc.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
        }

        // 2. PROCESS DB UPDATES
        const trustMatch = rawOutput.match(/\[trust: ([+-]\d+)\]/);
        if (trustMatch) userData.trustLevel += parseInt(trustMatch[1]);
        const tierMatch = rawOutput.match(/\[tier: (.*?)\]/);
        if (tierMatch) userData.tier = tierMatch[1];
        const saveMatch = rawOutput.match(/\[save: (.*?)\]/);
        if (saveMatch) userData.memoryVault.push(saveMatch[1]);

        // 3. CLEAN TEXT FOR DISCORD
        displayContent = displayContent.replace(/\[.*?\]/g, '').replace(/memory log:?.*$/gm, '').trim();

        await userData.save();

        // Handle Visuals
        let files = [];
        if (rawOutput.includes('[image:')) {
            const img = rawOutput.match(/\[image: (.*?)\]/)?.[1];
            files.push(`https://pollinations.ai/p/${encodeURIComponent(img)}?width=1024&height=1024&seed=${Math.random()}`);
        }

        await message.reply({ content: displayContent || 'm-mm..', files: files });

        // --- FREE NATURAL VOICE ENGINE ---
        const conn = getVoiceConnection(message.guild.id);
        if (conn && displayContent) {
            const tts = new edgeTTS.MsEdgeTTS();
            // 'en-US-AnaNeural' is free and sounds like a natural teen girl
            await tts.setMetadata('en-US-AnaNeural', 'output_16khz_32kbitrate_mono_mp3');
            
            const fPath = path.join(__dirname, `v_${message.author.id}.mp3`);
            await tts.toFile(fPath, displayContent);

            const player = createAudioPlayer();
            conn.subscribe(player);
            player.play(createAudioResource(fs.createReadStream(fPath), { inputType: StreamType.Arbitrary }));
            
            setTimeout(() => { if (fs.existsSync(fPath)) fs.unlinkSync(fPath); }, 20000);
        }
    } catch (e) { console.error(e); }
});

client.login(process.env.TOKEN);