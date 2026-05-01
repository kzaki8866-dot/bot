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
app.get('/', (req, res) => res.send('dollhouse neural link active 🎀'));
app.listen(process.env.PORT || 10000);

const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    username: String,
    tier: { type: String, default: "stranger" }, 
    trustLevel: { type: Number, default: 0 },
    moodTowardsUser: { type: String, default: "neutral" },
    memoryVault: { type: Array, default: [] },
    totalMessages: { type: Number, default: 0 },
    lastInteraction: { type: Date, default: Date.now }
}));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const client = new Client({ intents: [3276799] });

const SYSTEM_PROMPT = `you are a shy, vulgar teen comgirl. lowercase only. use stutters. MAX 1 SENTENCE.
NEVER type 'memory log', 'command tag', or 'score' in your reply. 
ONLY use tags like [JOIN_VC], [TRUST: +/-X], [TIER: status], [MOOD: mood], [SAVE: fact], [IMAGE: prompt], or [GIF: keyword] at the END of your message. 
these tags are HIDDEN and for the database only.`;

if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI).then(() => console.log("🧠 DB READY")).catch(err => console.log("❌ DB ERROR:", err.message));
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
                { role: "system", content: `${SYSTEM_PROMPT} \nTier: ${userData.tier} | Trust: ${userData.trustLevel} | Mood: ${userData.moodTowardsUser} \nMemories: ${userData.memoryVault.join(', ')}` },
                { role: "user", content: message.content }
            ],
            model: "llama-3.1-8b-instant",
        });

        let rawOutput = chatCompletion.choices[0].message.content.toLowerCase();
        let displayContent = rawOutput;
        let files = [];

        // --- TAG PROCESSING ---
        if (rawOutput.includes('[join_vc]')) {
            const vc = message.member.voice.channel;
            if (vc) joinVoiceChannel({ channelId: vc.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
        }

        const trustMatch = rawOutput.match(/\[trust: ([+-]\d+)\]/);
        if (trustMatch) userData.trustLevel += parseInt(trustMatch[1]);

        const tierMatch = rawOutput.match(/\[tier: (.*?)\]/);
        if (tierMatch) userData.tier = tierMatch[1];

        const saveMatch = rawOutput.match(/\[save: (.*?)\]/);
        if (saveMatch && !userData.memoryVault.includes(saveMatch[1])) userData.memoryVault.push(saveMatch[1]);

        // --- IMPROVED VISUAL LOGIC ---
        if (rawOutput.includes('[image:')) {
            const prompt = rawOutput.match(/\[image: (.*?)\]/)?.[1] || 'anime girl';
            files.push(`https://pollinations.ai/p/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${Math.random()}`);
        }
        
        if (rawOutput.includes('[gif:')) {
            const query = rawOutput.match(/\[gif: (.*?)\]/)?.[1] || 'anime';
            // Using a static Giphy ID that is known to work as a test, or a search link
            files.push(`https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExOHJtYjR0ZndieXN0eWR4ZndieXN0eWR4ZndieXN0eWR4JmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/MDJ9uLGiTLvMo/giphy.gif`);
        }

        // --- CLEAN DISPLAY CONTENT ---
        displayContent = displayContent.replace(/\[.*?\]/g, '')
                                     .replace(/memory log:?.*$/gm, '')
                                     .replace(/command tag:?.*$/gm, '')
                                     .replace(/your new status:?.*$/gm, '')
                                     .trim();

        userData.totalMessages += 1;
        await userData.save();

        await message.reply({ content: displayContent || 'm-mm..', files: files });

        // Voice
        const conn = getVoiceConnection(message.guild.id);
        if (conn && displayContent) {
            const speech = new gtts(displayContent, 'en');
            const fPath = path.join(__dirname, `v_${message.author.id}.mp3`);
            speech.save(fPath, () => {
                const player = createAudioPlayer();
                conn.subscribe(player);
                player.play(createAudioResource(fs.createReadStream(fPath), { inputType: StreamType.Arbitrary }));
                setTimeout(() => { if (fs.existsSync(fPath)) fs.unlinkSync(fPath); }, 15000);
            });
        }
    } catch (e) { console.error(e); }
});

client.login(process.env.TOKEN);