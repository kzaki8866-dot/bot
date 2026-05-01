require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, NoSubscriberBehavior, StreamType, getVoiceConnection } = require('@discordjs/voice');
const mongoose = require('mongoose');
const { FishAudioClient } = require('fish-audio'); // Fish Audio SDK
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('dollhouse neural link active 🎀'));
app.listen(process.env.PORT || 10000);

// --- DB SCHEMA ---
const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    tier: { type: String, default: "stranger" }, 
    memoryVault: { type: Array, default: [] },
    trustLevel: { type: Number, default: 0 }
}));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const fishAudio = new FishAudioClient({ apiKey: process.env.FISH_API_KEY });
const client = new Client({ intents: [3276799] });

// --- UPDATED PROMPT FOR EMOTIONAL TTS ---
const SYSTEM_PROMPT = `you are a shy, vulgar teen comgirl. lowercase only. use stutters. MAX 1 SENTENCE.
you can use emotional cues for your voice engine like (whispers), (stutters), (giggles), or (annoyed). 
Example: '(stutters) m-mm.. what do u want?'
TAGS: [JOIN_VC], [TRUST: +/-X], [TIER: status], [SAVE: fact], [IMAGE: prompt]`;

if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI).then(() => console.log("🧠 DB READY"));
}

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const isPinged = message.mentions.has(client.user);
    if (!isPinged && Math.random() > 0.15) return;

    await message.channel.sendTyping();

    try {
        let userData = await User.findOne({ userId: message.author.id }) || await User.create({ userId: message.author.id });

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: `${SYSTEM_PROMPT} \nStatus: ${userData.tier} | Memories: ${userData.memoryVault.join(', ')}` },
                { role: "user", content: message.content }
            ],
            model: "llama-3.1-8b-instant",
        });

        let rawOutput = chatCompletion.choices[0].message.content.toLowerCase();
        let displayContent = rawOutput;

        // 1. PROCESS VC JOIN
        if (rawOutput.includes('[join_vc]')) {
            const vc = message.member.voice.channel;
            if (vc) joinVoiceChannel({ channelId: vc.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
        }

        // 2. DB UPDATES (TIER/TRUST/MEM)
        const tierMatch = rawOutput.match(/\[tier: (.*?)\]/);
        if (tierMatch) { userData.tier = tierMatch[1]; await userData.save(); }
        
        const saveMatch = rawOutput.match(/\[save: (.*?)\]/);
        if (saveMatch) { userData.memoryVault.push(saveMatch[1]); await userData.save(); }

        // 3. CLEAN FOR TEXT DISPLAY (Leave emotion cues for voice but hide from chat)
        displayContent = displayContent.replace(/\[.*?\]/g, '').trim();

        await message.reply({ content: displayContent || 'm-mm..' });

        // --- FISH.AUDIO TTS ENGINE ---
        const conn = getVoiceConnection(message.guild.id);
        if (conn && displayContent) {
            const fPath = path.join(__dirname, `v_${message.author.id}.mp3`);
            
            // Fish.audio Convert call
            const audioData = await fishAudio.textToSpeech.convert({
                text: displayContent,
                format: 'mp3',
                reference_id: '792015e1008f4c1c876b50e0f3cf160a' // This is a specific "Cute Girl" voice ID
            });

            // Save the stream to a file
            const writer = fs.createWriteStream(fPath);
            audioData.pipe(writer);

            writer.on('finish', () => {
                const player = createAudioPlayer();
                conn.subscribe(player);
                player.play(createAudioResource(fs.createReadStream(fPath), { inputType: StreamType.Arbitrary }));
                setTimeout(() => { if (fs.existsSync(fPath)) fs.unlinkSync(fPath); }, 20000);
            });
        }
    } catch (e) { console.error("Critical Error:", e); }
});

client.login(process.env.TOKEN);