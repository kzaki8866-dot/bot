require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, VoiceConnectionStatus, entersState, StreamType, AudioPlayerStatus } = require('@discordjs/voice');
const mongoose = require('mongoose');
const gtts = require('gtts');
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');
const express = require('express');

// --- 1. WEB SERVER ---
const app = express();
app.listen(process.env.PORT || 10000);

// --- 2. GLOBAL SETUP ---
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

// --- 3. ADVANCED DATABASE SCHEMA (State Machine) ---
// We track physical and emotional needs over time.
const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    username: String,
    tier: { type: String, default: "dada" }, 
    // Emotional Stats (0 to 100)
    affection: { type: Number, default: 50 }, // 0 = neglected, 100 = loved
    hunger: { type: Number, default: 50 },    // 0 = full, 100 = starving
    energy: { type: Number, default: 50 },    // 0 = sweepy, 100 = hyper
    lastInteraction: { type: Date, default: Date.now }
}));

// --- 4. VOCABULARY ENFORCER ---
// This intercepts the AI's text and forces consistent cute words.
const VOCAB_MAP = {
    "drink": "dwinkie", "water": "dwinkie", "beverage": "dwinkie",
    "milk": "mwilk", "milkshake": "mwilk",
    "food": "nummies", "eat": "num num", "hungry": "hungwy",
    "sleep": "nappies", "tired": "sweepy", "bed": "nappies",
    "sorry": "sowwy", "please": "pwease", "cry": "cwies",
    "dad": "dada", "father": "dada", "you": "chu"
};

function enforceBabyVocab(text) {
    let newText = text.toLowerCase();
    // Replace 'r' and 'l' with 'w' (basic cute lisp)
    newText = newText.replace(/(?:r|l)/g, 'w'); 
    
    // Hard-replace specific dictionary words
    for (const [word, replacement] of Object.entries(VOCAB_MAP)) {
        const regex = new RegExp(`\\b${word}\\b`, 'g');
        newText = newText.replace(regex, replacement);
    }
    return newText;
}

// --- 5. EMOTION CALCULATOR ---
function calculateMood(userData) {
    if (userData.hunger > 80) return "Cranky and Starving";
    if (userData.energy < 20) return "Very Sleepy and Fussy";
    if (userData.affection < 30) return "Lonely and Sad";
    if (userData.energy > 80 && userData.hunger < 30) return "Hyper and Happy";
    return "Clingy and Needy";
}

mongoose.connect(process.env.MONGO_URI).then(() => console.log("🧠 ADVANCED EMOTION ENGINE ONLINE"));

// --- 6. VOICE QUEUE SYSTEM (Fixes the TTS not playing) ---
const voicePlayer = createAudioPlayer();
let isPlaying = false;

voicePlayer.on(AudioPlayerStatus.Idle, () => {
    console.log("🔊 Finished playing. Ready for next.");
    isPlaying = false;
});

client.once(Events.ClientReady, (readyClient) => console.log(`✅ ${readyClient.user.tag} IS LIVE`));

client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;

    if (processedMessages.has(message.id)) return;
    processedMessages.add(message.id);
    setTimeout(() => processedMessages.delete(message.id), 10000);

    const isPinged = message.mentions.users.has(client.user.id);
    if (!isPinged && Math.random() > 0.05) return;

    await message.channel.sendTyping();

    try {
        let userData = await User.findOne({ userId: message.author.id }) || await User.create({ userId: message.author.id, username: message.author.username });

        // Time decay mechanic: She gets hungry and tired if you ignore her.
        const hoursSinceLast = (Date.now() - userData.lastInteraction.getTime()) / (1000 * 60 * 60);
        if (hoursSinceLast > 1) {
            userData.hunger = Math.min(100, userData.hunger + Math.floor(hoursSinceLast * 10));
            userData.energy = Math.max(0, userData.energy - Math.floor(hoursSinceLast * 10));
            userData.affection = Math.max(0, userData.affection - Math.floor(hoursSinceLast * 5));
        }

        const currentMood = calculateMood(userData);

        const SYSTEM_PROMPT = `You are 'mommy', an extremely needy, innocent virtual baby companion.
YOUR CURRENT VITAL STATS:
- Hunger: ${userData.hunger}/100 
- Energy: ${userData.energy}/100 
- Affection: ${userData.affection}/100
- Overall Mood: ${currentMood}

INSTRUCTIONS:
1. React to your stats! If hunger is high, beg for nummies/mwilk. If energy is low, ask for nappies.
2. Keep responses to 1 short sentence.
3. Lowercase only.

HIDDEN COMMANDS:
[JOIN_VC] - join voice channel.
[FEED: +/-X] - change hunger.
[NAP: +/-X] - change energy.
[LOVE: +/-X] - change affection.`;

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: message.content }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.8
        });

        let rawOutput = chatCompletion.choices[0].message.content.toLowerCase();

        // --- EXECUTE COMMANDS ---
        if (rawOutput.includes('[join_vc]')) {
            const vc = message.member.voice.channel;
            if (vc) {
                const connection = joinVoiceChannel({ channelId: vc.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
                connection.subscribe(voicePlayer);
            }
        }

        // Adjust stats based on AI decisions
        const feedChange = rawOutput.match(/\[feed: ([+-]?\d+)\]/);
        if (feedChange) userData.hunger = Math.max(0, Math.min(100, userData.hunger - parseInt(feedChange[1]))); // minus hunger = fed

        const napChange = rawOutput.match(/\[nap: ([+-]?\d+)\]/);
        if (napChange) userData.energy = Math.max(0, Math.min(100, userData.energy + parseInt(napChange[1])));

        const loveChange = rawOutput.match(/\[love: ([+-]?\d+)\]/);
        if (loveChange) userData.affection = Math.max(0, Math.min(100, userData.affection + parseInt(loveChange[1])));

        userData.lastInteraction = Date.now();
        await userData.save();

        // --- CLEAN AND ENFORCE VOCABULARY ---
        let cleanText = rawOutput.replace(/\[.*?\]/g, '').trim();
        let enforcedText = enforceBabyVocab(cleanText); // Intercept and fix the words!

        await message.reply(enforcedText || 'm-mm.. pwease..');

        // --- BULLETPROOF AUDIO ENGINE ---
        const conn = getVoiceConnection(message.guild.id);
        if (conn && enforcedText && !isPlaying) {
            // Strip emojis so TTS doesn't crash
            let ttsText = enforcedText.replace(/[\u{1F600}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
            
            if (ttsText.trim().length > 0) {
                isPlaying = true;
                const speech = new gtts(ttsText, 'en');
                const fPath = path.join(__dirname, `v_${message.id}.mp3`);
                
                speech.save(fPath, () => {
                    // Start playing the file
                    const resource = createAudioResource(fs.createReadStream(fPath), { inputType: StreamType.Arbitrary });
                    voicePlayer.play(resource);

                    // SAFE DELETE: Wait until the file is completely done playing before deleting
                    voicePlayer.once(AudioPlayerStatus.Idle, () => {
                        setTimeout(() => { 
                            if (fs.existsSync(fPath)) fs.unlinkSync(fPath); 
                        }, 2000); // 2 second buffer after silence
                    });
                });
            }
        }

    } catch (e) { 
        console.error("🛑 Engine Error:", e.message); 
    }
});

client.login(process.env.TOKEN);