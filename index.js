require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, VoiceConnectionStatus, entersState, StreamType } = require('@discordjs/voice');
const mongoose = require('mongoose');
const gtts = require('gtts');
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');
const express = require('express');

const app = express();
app.listen(process.env.PORT || 10000);

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

const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    username: String,
    tier: { type: String, default: "stwangew" }, 
    trustLevel: { type: Number, default: 0 },
    moodTowardsUser: { type: String, default: "sweepy" },
    memoryVault: { type: Array, default: [] }
}));

// --- THE BABEH BRAIN ---
const SYSTEM_PROMPT = `you are 'baby' but you are actually a tiny, helpless babeh. 
personality: clingy, innocent, and high-maintenance. you need dada for everything.
speech: lowercase only. use 'w' for 'r' (sowwy, mwilk, hungwy, diapi). use baby talk like 'pwease', 'dwinkie', 'uppies'. MAX 2 SENTENCES. dont talk about one thing all over again

COMMANDS:
[JOIN_VC] - come to dada in voice.
[TRUST: +/-number] - update trust.
[TIER: status] - dada, mama, stwangew.
[MOOD: mood] - hungwy, messy, sweepy, happy.
[SAVE: fact] - baby remembers.
[IMAGE: prompt] - baby show pic.`;

mongoose.connect(process.env.MONGO_URI).then(() => console.log("🧠 BABEH BRAIN READY"));

client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;
    if (processedMessages.has(message.id)) return;
    processedMessages.add(message.id);
    setTimeout(() => processedMessages.delete(message.id), 15000);

    const isPinged = message.mentions.users.has(client.user.id);
    if (!isPinged && Math.random() > 0.05) return;

    await message.channel.sendTyping();

    try {
        let userData = await User.findOne({ userId: message.author.id }) || await User.create({ userId: message.author.id, username: message.author.username });

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: `${SYSTEM_PROMPT}\nStats: Tier: ${userData.tier} | Mood: ${userData.moodTowardsUser}` },
                { role: "user", content: message.content }
            ],
            model: "llama-3.3-70b-versatile",
        });

        let rawOutput = chatCompletion.choices[0].message.content.toLowerCase();
        
        // VC Join
        if (rawOutput.includes('[join_vc]')) {
            const vc = message.member.voice.channel;
            if (vc) joinVoiceChannel({ channelId: vc.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
        }

        // Data Logic
        const trustChange = rawOutput.match(/\[trust: ([+-]\d+)\]/);
        if (trustChange) userData.trustLevel += parseInt(trustChange[1]);
        const tierUpdate = rawOutput.match(/\[tier: (.*?)\]/);
        if (tierUpdate) userData.tier = tierUpdate[1];
        const moodUpdate = rawOutput.match(/\[mood: (.*?)\]/);
        if (moodUpdate) userData.moodTowardsUser = moodUpdate[1];

        await userData.save();

        let displayContent = rawOutput.replace(/\[.*?\]/g, '').trim();

        // Send Text
        let files = [];
        const imgMatch = rawOutput.match(/\[image: (.*?)\]/);
        if (imgMatch) files.push(`https://pollinations.ai/p/${encodeURIComponent(imgMatch[1])}?width=1024&height=1024&seed=${Math.random()}`);
        
        await message.reply({ content: displayContent || 'm-mm.. hungwy..', files });

        // --- THE OLD WORKING gTTS VOICE ---
        const conn = getVoiceConnection(message.guild.id);
        if (conn && displayContent) {
            let ttsText = displayContent.replace(/[\u{1F600}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
            const speech = new gtts(ttsText, 'en');
            const fPath = path.join(__dirname, `v_${message.id}.mp3`);
            
            speech.save(fPath, () => {
                const player = createAudioPlayer();
                conn.subscribe(player);
                player.play(createAudioResource(fs.createReadStream(fPath), { inputType: StreamType.Arbitrary }));
                setTimeout(() => { if (fs.existsSync(fPath)) fs.unlinkSync(fPath); }, 20000);
            });
        }
    } catch (e) { console.error(e); }
});
// Inside client.on(Events.MessageCreate...)
const safeUserInput = `"""${message.content}"""`;
const app = express();
app.get('/', (req, res) => res.send('Bot is awake and secure! 🛡️'));
const port = process.env.PORT || 10000;
app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Web server is alive on port ${port}`);
});


client.login(process.env.TOKEN);