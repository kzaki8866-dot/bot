require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, NoSubscriberBehavior, StreamType, getVoiceConnection } = require('@discordjs/voice');
const mongoose = require('mongoose');
const edgeTTS = require('edge-tts'); // Switched from gTTS
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
ONLY use tags like [JOIN_VC], [TRUST: +/-X], [TIER: status], [MOOD: mood], [SAVE: fact], [IMAGE: prompt], or [GIF: keyword] at the END.`;

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

        // Handle tags (VC, Trust, etc)
        if (rawOutput.includes('[join_vc]')) {
            const vc = message.member.voice.channel;
            if (vc) joinVoiceChannel({ channelId: vc.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
        }

        // Logic for cleaning display text
        displayContent = displayContent.replace(/\[.*?\]/g, '').replace(/memory log:?.*$/gm, '').replace(/command tag:?.*$/gm, '').trim();

        // Update DB
        userData.totalMessages += 1;
        await userData.save();

        // Handle Visuals
        if (rawOutput.includes('[image:')) {
            const prompt = rawOutput.match(/\[image: (.*?)\]/)?.[1];
            files.push(`https://pollinations.ai/p/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${Math.random()}`);
        }

        await message.reply({ content: displayContent || 'm-mm..', files: files });

        // --- NEW REALISTIC VOICE ENGINE ---
        const conn = getVoiceConnection(message.guild.id);
        if (conn && displayContent) {
            const tts = new edgeTTS.MsEdgeTTS();
            // Voice 'en-US-AnaNeural' is a realistic, slightly shy-sounding teen girl
            await tts.setMetadata('en-US-AnaNeural', 'output_16khz_32kbitrate_mono_mp3');
            
            const fPath = path.join(__dirname, `v_${message.author.id}.mp3`);
            const filePath = await tts.toFile(fPath, displayContent);

            const player = createAudioPlayer();
            conn.subscribe(player);
            player.play(createAudioResource(fs.createReadStream(fPath), { inputType: StreamType.Arbitrary }));
            
            setTimeout(() => { if (fs.existsSync(fPath)) fs.unlinkSync(fPath); }, 20000);
        }
    } catch (e) { console.error(e); }
});

client.login(process.env.TOKEN);