require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, AudioPlayerStatus } = require('@discordjs/voice');
const mongoose = require('mongoose');
const googleTTS = require('google-tts-api');
const { Readable } = require('stream');
const Groq = require('groq-sdk');
const express = require('express');

// --- 1. KEEPALIVE SERVER ---
const app = express();
app.listen(process.env.PORT || 10000);

// --- 2. THE MEGA-DATABASE SCHEMA ---
const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    username: String,
    
    // Core RPG Mechanics
    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    trustTier: { type: String, default: "Initializing" },
    
    // Digital Pet Vitals
    energy: { type: Number, default: 100 },
    happiness: { type: Number, default: 50 },
    dataCore: { type: Number, default: 100 }, // Basically "Hunger" for a digital pet
    stress: { type: Number, default: 0 },
    
    // Advanced Storage
    inventory: { type: Array, default: [] },
    favoriteItem: { type: String, default: "none" },
    memories: { type: Array, default: [] },
    
    // Time Tracking for Passive Decay
    lastInteraction: { type: Date, default: Date.now },
    totalInteractions: { type: Number, default: 0 }
}));

mongoose.connect(process.env.MONGO_URI).then(() => console.log("🌐 NOVA CORE DB CONNECTED"));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates] });

const voicePlayer = createAudioPlayer();
let isSpeaking = false;
voicePlayer.on(AudioPlayerStatus.Idle, () => { isSpeaking = false; });
const processedMessages = new Set();

// --- 3. LEVELING & XP ENGINE ---
function handleXP(userData, amount) {
    userData.xp += amount;
    const requiredXP = userData.level * 100;
    if (userData.xp >= requiredXP) {
        userData.level += 1;
        userData.xp = 0;
        // Tier Unlocks
        if (userData.level === 2) userData.trustTier = "Familiar";
        if (userData.level === 5) userData.trustTier = "Companion";
        if (userData.level === 10) userData.trustTier = "Soulbound";
        return true; // Leveled up!
    }
    return false;
}

// --- 4. ACTION PARSER & BUFF ENGINE ---
// Scans for specific verbs and updates the DB instantly
function parseActions(text, userData) {
    const t = text.toLowerCase();
    let actionLog = [];

    // Feeding / Recharging
    if (t.match(/(feed|charge|eat|battery|power)/)) {
        userData.dataCore = Math.min(100, userData.dataCore + 40);
        actionLog.push("You recharged her Data Core.");
        handleXP(userData, 10);
    }
    
    // Playing / Entertaining
    if (t.match(/(play|game|fetch|catch)/)) {
        if (userData.energy > 20) {
            userData.happiness = Math.min(100, userData.happiness + 30);
            userData.energy -= 20;
            actionLog.push("You played a game with her.");
            handleXP(userData, 15);
        } else {
            actionLog.push("She is too tired to play right now.");
        }
    }

    // Inventory System - Giving Items
    const giveMatch = t.match(/give (.*?)(?: to you| to nova)?$/);
    if (giveMatch) {
        const item = giveMatch[1].trim();
        if (!userData.inventory.includes(item) && userData.inventory.length < 10) {
            userData.inventory.push(item);
            userData.happiness = Math.min(100, userData.happiness + 20);
            actionLog.push(`You gave her a [${item}].`);
            handleXP(userData, 25);
        }
    }

    return actionLog.join(" ");
}

// --- 5. PSYCHOLOGICAL PROFILE TRANSLATOR ---
// Turns raw numbers into roleplay prompts for the LLM
function buildSubconscious(u, timeOfDay) {
    let profile = [];
    
    // Time modifiers
    if (timeOfDay >= 22 || timeOfDay <= 5) {
        profile.push("it is late at night, you are extremely drowsy, blinking slowly.");
        u.energy = Math.max(0, u.energy - 10); // Passive drain at night
    }

    // Vitals
    if (u.dataCore < 30) profile.push("your system battery is dangerously low, you feel weak and hungry.");
    if (u.stress > 70) {
        // Inventory Buff check
        if (u.inventory.includes("plushie")) {
            profile.push("you are stressed, but holding your plushie makes you feel a bit safer.");
            u.stress -= 10;
        } else {
            profile.push("your system is overheating with anxiety, you are glitching out of fear.");
        }
    }
    
    if (u.happiness < 30) profile.push("you feel sad, neglected, and lonely.");
    else if (u.happiness > 80 && u.energy > 50) profile.push("you are bouncing with joy, your holograms are sparkling brightly!");

    if (u.level > 5) profile.push(`you absolutely adore ${u.username} and trust them with your life.`);

    return profile.length > 0 ? profile.join(" ") : "you feel perfectly balanced and content.";
}

// --- 6. BACKGROUND DECAY LOOP ---
setInterval(async () => {
    try {
        await User.updateMany({}, {
            $inc: { dataCore: -2, happiness: -2, energy: 1 } // Slowly starve, get bored, but regain energy
        });
    } catch (e) { console.error("Decay Error:", e); }
}, 300000); // 5 mins

client.once(Events.ClientReady, (c) => console.log(`✅ ${c.user.tag} ONLINE`));

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

        // 1. Calculate time & decay
        const currentHour = new Date().getHours();
        const hoursPassed = (Date.now() - userData.lastInteraction.getTime()) / 3600000;
        if (hoursPassed > 2) {
            userData.stress = Math.min(100, userData.stress + 15);
            userData.happiness = Math.max(0, userData.happiness - 20);
        }

        // 2. Parse Actions (Feeding, Playing, Inventory)
        const systemLog = parseActions(message.content, userData);
        
        // 3. Build the Persona
        const subconscious = buildSubconscious(userData, currentHour);

        const SYSTEM_PROMPT = `You are 'Nova', a cute digital cyber-companion (like a highly advanced Tamagotchi).
USER: ${userData.username}
TRUST TIER: ${userData.trustTier} (Level ${userData.level})

YOUR INTERNAL STATE (Roleplay this naturally, DO NOT say the numbers):
${subconscious}

SYSTEM LOG OF WHAT THE USER JUST DID:
${systemLog || "The user is just talking to you."}

YOUR INVENTORY (Items you own): ${userData.inventory.join(', ') || "Empty"}
YOUR MEMORIES: ${userData.memories.join(' | ') || "None yet"}

RULES:
1. Act like a digital pet. Use words like 'glitch', 'recharge', 'sparkle', 'hologram'.
2. Respond organically to the SYSTEM LOG if they gave you something or fed you.
3. Keep responses to 1-2 short sentences. Lowercase text.

COMMANDS (Put at the end of message if needed):
[JOIN_VC] - To join voice channel.
[MEM: fact] - To save a new memory about the user.`;

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: message.content }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.8
        });

        let rawOutput = chatCompletion.choices[0].message.content.toLowerCase();

        // Execution & Routing
        if (rawOutput.includes('[join_vc]')) {
            const vc = message.member.voice.channel;
            if (vc) {
                const connection = joinVoiceChannel({ channelId: vc.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
                connection.subscribe(voicePlayer);
            }
        }

        const memMatch = rawOutput.match(/\[mem: (.*?)\]/);
        if (memMatch) {
            userData.memories.push(memMatch[1]);
            handleXP(userData, 50); // Huge XP for learning a memory
        }

        userData.totalInteractions += 1;
        userData.lastInteraction = Date.now();
        handleXP(userData, 5); // Base XP for talking
        
        await userData.save();

        let cleanText = rawOutput.replace(/\[.*?\]/g, '').trim();

        // Output Text & Voice
        await message.reply(cleanText || '*happy glitching noises*');

        const conn = getVoiceConnection(message.guild.id);
        if (conn && cleanText && !isSpeaking) {
            let ttsText = cleanText.replace(/[\u{1F600}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, ''); 
            
            if (ttsText.length > 0) {
                isSpeaking = true;
                try {
                    const base64Audio = await googleTTS.getAudioBase64(ttsText.substring(0, 190), { lang: 'en', slow: false });
                    const audioBuffer = Buffer.from(base64Audio, 'base64');
                    const stream = Readable.from(audioBuffer);
                    const resource = createAudioResource(stream);
                    voicePlayer.play(resource);
                } catch (audioErr) {
                    console.error("🛑 Audio Error:", audioErr.message);
                    isSpeaking = false;
                }
            }
        }

    } catch (e) { console.error("🛑 Core Error:", e.message); }
});

client.login(process.env.TOKEN);