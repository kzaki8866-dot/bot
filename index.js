require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, NoSubscriberBehavior, StreamType, getVoiceConnection } = require('@discordjs/voice');
const mongoose = require('mongoose');
const gtts = require('gtts');
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('dollhouse is open 🎀'));
app.listen(process.env.PORT || 10000);

// --- ADVANCED DATABASE SCHEMA ---
const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    username: String,
    relationship: { type: String, default: "stranger" }, // bestie, bf, hater, enemy, etc.
    memory: { type: String, default: "nothing known yet" },
    behaviorScore: { type: Number, default: 0 }, // + for nice, - for mean
    lastInteraction: { type: Date, default: Date.now }
}));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const client = new Client({ 
    intents: [3276799] 
});

// --- THE MASTER PROMPT ---
const SYSTEM_PROMPT = `you are a shy, vulgar teen comgirl. lowercase only. use stutters. MAX 1 SENTENCE.
RELATIONSHIP LOGIC:
- if user is nice, they are 'bestie' or 'bf'.
- if user is mean, they are 'hater' or 'enemy'.
- always update your internal view of them.

COMMAND TAGS (Use these at the end of your reply):
1. [JOIN_VC]: use this IF the user is asking you to join voice in any way (e.g., 'come here', 'get in', 'join us').
2. [REL: category]: use this to update their status (e.g., [REL: bf], [REL: enemy]).
3. [MEM: fact]: use this to save a fact about them.
4. [IMAGE: prompt] or [GIF: keyword]: for visuals.`;

if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI).then(() => console.log("🧠 NEURAL LINK ACTIVE (DB)")).catch(err => console.log("❌ DB ERROR:", err.message));
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
                { role: "system", content: `${SYSTEM_PROMPT} 
                  USER DATA: 
                  Status: ${userData.relationship}
                  Memory: ${userData.memory}
                  Score: ${userData.behaviorScore}` 
                },
                { role: "user", content: message.content }
            ],
            model: "llama-3.1-8b-instant",
        });

        let aiResponse = chatCompletion.choices[0].message.content.toLowerCase();

        // 1. AI DETECTION: JOIN VC
        if (aiResponse.includes('[join_vc]')) {
            const vc = message.member.voice.channel;
            if (vc) {
                joinVoiceChannel({ channelId: vc.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
            }
            aiResponse = aiResponse.replace('[join_vc]', '');
        }

        // 2. RELATIONSHIP UPDATER
        if (aiResponse.includes('[rel:')) {
            userData.relationship = aiResponse.match(/\[rel: (.*?)\]/)?.[1] || userData.relationship;
            aiResponse = aiResponse.replace(/\[rel:.*?\]/g, '');
        }

        // 3. MEMORY UPDATER
        if (aiResponse.includes('[mem:')) {
            userData.memory = aiResponse.match(/\[mem: (.*?)\]/)?.[1] || userData.memory;
            aiResponse = aiResponse.replace(/\[mem:.*?\]/g, '');
        }

        await userData.save();

        // Handle Files
        let files = [];
        if (aiResponse.includes('[image:')) {
            const img = aiResponse.match(/\[image: (.*?)\]/)?.[1];
            files.push(`https://pollinations.ai/p/${encodeURIComponent(img)}?width=1024&height=1024&seed=${Math.random()}`);
            aiResponse = aiResponse.replace(/\[image:.*?\]/g, '');
        }

        await message.reply({ content: aiResponse.trim() || '...', files: files });

        // Voice Engine
        const conn = getVoiceConnection(message.guild.id);
        if (conn && aiResponse) {
            const speech = new gtts(aiResponse, 'en');
            const fPath = path.join(__dirname, `v_${message.author.id}.mp3`);
            speech.save(fPath, () => {
                const player = createAudioPlayer();
                conn.subscribe(player);
                player.play(resource = createAudioResource(fs.createReadStream(fPath), { inputType: StreamType.Arbitrary }));
                setTimeout(() => { if (fs.existsSync(fPath)) fs.unlinkSync(fPath); }, 15000);
            });
        }
    } catch (e) { console.error(e); }
});

client.login(process.env.TOKEN);