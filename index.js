require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, VoiceConnectionStatus, entersState, StreamType } = require('@discordjs/voice');
const mongoose = require('mongoose');
const gtts = require('gtts');
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');
const express = require('express');

// --- 1. WEB SERVER ---
const app = express();
app.listen(process.env.PORT || 10000);

// --- 2. GLOBAL LOCKS & CLIENT ---
const processedMessages = new Set(); 
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ] 
});

// --- 3. DATABASE SCHEMA ---
const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    username: String,
    tier: { type: String, default: "stranger" }, 
    trustLevel: { type: Number, default: 0 },
    moodTowardsUser: { type: String, default: "neutral" },
    memoryVault: { type: Array, default: [] }
}));

const SYSTEM_PROMPT = `you are 'mommy'. shy, protective teen girl. lowercase only. use stutters.
COMMANDS (End of reply):
[JOIN_VC] - join voice.
[TRUST: +/-number] - update trust.
[TIER: status] - stranger, friend, bestie, lover, enemy.
[MOOD: mood] - update mood.
[SAVE: fact] - save memory.
[IMAGE: prompt] - send pic.`;

mongoose.connect(process.env.MONGO_URI).then(() => console.log("🧠 DB SYNCED"));

client.once(Events.ClientReady, (readyClient) => console.log(`✅ ${readyClient.user.tag} IS LIVE`));

client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;

    // --- ANTI-DOUBLE FIX ---
    if (processedMessages.has(message.id)) return;
    processedMessages.add(message.id);
    setTimeout(() => processedMessages.delete(message.id), 15000);

    const isPinged = message.mentions.users.has(client.user.id);
    const randomChime = Math.random() < 0.05; // 5% chance to talk anyway
    
    if (!isPinged && !randomChime) return;

    await message.channel.sendTyping();

    try {
        let userData = await User.findOne({ userId: message.author.id }) || await User.create({ userId: message.author.id, username: message.author.username });

        // --- THE 2026 BRAIN ---
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: `${SYSTEM_PROMPT}\nStats for ${message.author.username}: Tier: ${userData.tier} | Trust: ${userData.trustLevel} | Mood: ${userData.moodTowardsUser} | Memories: ${userData.memoryVault.join(', ')}` },
                { role: "user", content: message.content }
            ],
            model: "llama-3.1-8b-instant", // 100% STABLE 2026 MODEL
        });

        let rawOutput = chatCompletion.choices[0].message.content.toLowerCase();
        let displayContent = rawOutput;

        // 1. VOICE JOIN
        if (rawOutput.includes('[join_vc]')) {
            const vc = message.member.voice.channel;
            if (vc) {
                joinVoiceChannel({ 
                    channelId: vc.id, 
                    guildId: message.guild.id, 
                    adapterCreator: message.guild.voiceAdapterCreator 
                });
            }
        }

        // 2. DATA UPDATES
        const trustChange = rawOutput.match(/\[trust: ([+-]\d+)\]/);
        if (trustChange) userData.trustLevel += parseInt(trustChange[1]);

        const tierUpdate = rawOutput.match(/\[tier: (.*?)\]/);
        if (tierUpdate) userData.tier = tierUpdate[1];

        const moodUpdate = rawOutput.match(/\[mood: (.*?)\]/);
        if (moodUpdate) userData.moodTowardsUser = moodUpdate[1];

        const memoryUpdate = rawOutput.match(/\[save: (.*?)\]/);
        if (memoryUpdate) userData.memoryVault.push(memoryUpdate[1]);

        await userData.save();

        // 3. CLEAN CONTENT
        displayContent = displayContent.replace(/\[.*?\]/g, '').trim();

        // 4. IMAGE HANDLING
        let files = [];
        const imgMatch = rawOutput.match(/\[image: (.*?)\]/);
        if (imgMatch) {
            files.push(`https://pollinations.ai/p/${encodeURIComponent(imgMatch[1])}?width=1024&height=1024&seed=${Math.random()}`);
        }

        await message.reply({ content: displayContent || 'u-um..', files });

        // --- 5. THE CLASSIC VOICE ENGINE (MP3 FILE METHOD) ---
        const conn = getVoiceConnection(message.guild.id);
        if (conn && displayContent) {
            // Clean displayContent for TTS
            let ttsContent = displayContent.replace(/[\u{1F600}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
            
            if (ttsContent.trim().length > 0) {
                const speech = new gtts(ttsContent, 'en');
                const fPath = path.join(__dirname, `v_${message.id}.mp3`); // ID unique to this message
                
                speech.save(fPath, () => {
                    const player = createAudioPlayer();
                    conn.subscribe(player);
                    
                    const resource = createAudioResource(fs.createReadStream(fPath), { 
                        inputType: StreamType.Arbitrary 
                    });
                    
                    player.play(resource);

                    // Delete file after 20 seconds
                    setTimeout(() => { 
                        if (fs.existsSync(fPath)) fs.unlinkSync(fPath); 
                    }, 20000);
                });
            }
        }
    } catch (e) { console.error("🛑 API Error:", e.message); }
});

client.login(process.env.TOKEN);