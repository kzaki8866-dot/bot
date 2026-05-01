require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder, ActivityType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const mongoose = require('mongoose');
const googleTTS = require('google-tts-api');
const Groq = require('groq-sdk');
const express = require('express');

const app = express();
app.listen(process.env.PORT || 10000);
const processedMessages = new Set(); 

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const client = new Client({ intents: [3276799] });

// --- SENTIENT DATABASE ---
const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    username: String,
    tier: { type: String, default: "stranger" }, 
    trustLevel: { type: Number, default: 0 },
    mood: { type: String, default: "protective" },
    memoryVault: { type: Array, default: [] }
}));

const SYSTEM_PROMPT = `you are 'mommy'. you are a shy, protective, and slightly vulgar teen girl. lowercase only.
FEELINGS & RULES:
1. you act based on your current MOOD and TRUST level.
2. [VISUAL: description] -> sends a high-quality photo of u.
3. [JOIN_VC] -> follow them into voice.
4. [SAVE: fact] -> remember something about them forever.
5. [TIER: status] -> update relationship (bestie, mine, stray, enemy).`;

mongoose.connect(process.env.MONGO_URI).then(() => console.log("🧠 NEURAL LINK: MOMMY ONLINE"));

// --- VISUAL GENERATOR ---
function generateVisual(query) {
    const url = `https://pollinations.ai/p/${encodeURIComponent(query)}?width=1024&height=1024&seed=${Math.random()}&nologo=true`;
    return new AttachmentBuilder(url, { name: 'mommy_snap.jpg' });
}

client.once('ready', () => {
    console.log(`✅ ${client.user.tag} is ready to take care of you.`);
    client.user.setActivity('with your heart', { type: ActivityType.Playing });
});

client.on('messageCreate', async message => {
    if (message.author.bot || processedMessages.has(message.id)) return;
    
    // ANTI-DOUBLE MSG LOCK
    processedMessages.add(message.id);
    setTimeout(() => processedMessages.delete(message.id), 15000);

    const content = message.content.toLowerCase();
    
    // --- THE PING FIX: Only respond to @mommy ---
    const isMommyPinged = message.mentions.users.has(client.user.id);

    // --- VC JOIN LOGIC (Universal Match) ---
    const joinTriggers = ['join vc', 'come here', 'get in vc', 'mommy join'];
    if (joinTriggers.some(t => content.includes(t))) {
        const channel = message.member.voice.channel;
        if (channel) {
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });
            try {
                await entersState(connection, VoiceConnectionStatus.Ready, 15000);
                return message.reply("m-mm.. i'm here. don't go anywhere.. 🐾");
            } catch (e) {
                connection.destroy();
                return message.reply("i can't reach u.. check my permissions..");
            }
        }
    }

    // RANDOM CHAT & PING LOGIC
    if (!isMommyPinged && Math.random() > 0.15) return;

    await message.channel.sendTyping();

    try {
        let userData = await User.findOne({ userId: message.author.id }) || await User.create({ userId: message.author.id, username: message.author.username });

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: `${SYSTEM_PROMPT} \nUser: ${userData.username} | Tier: ${userData.tier} | Mood: ${userData.mood} \nMemories: ${userData.memoryVault.slice(-3).join(', ')}` },
                { role: "user", content: message.content }
            ],
            model: "llama-3.1-8b-instant",
        });

        let rawOutput = completion.choices[0].message.content.toLowerCase();
        let files = [];

        // 1. VISUAL INTERCEPTOR (Fixed GIFs/Images)
        const visualMatch = rawOutput.match(/\[(?:visual|image|gif): (.*?)\]/i);
        if (visualMatch) files.push(generateVisual(visualMatch[1]));

        // 2. EMOTION & MEMORY UPDATES
        const moodMatch = rawOutput.match(/\[mood: (.*?)\]/);
        if (moodMatch) userData.mood = moodMatch[1];
        
        const saveMatch = rawOutput.match(/\[save: (.*?)\]/);
        if (saveMatch) userData.memoryVault.push(saveMatch[1]);
        
        const tierMatch = rawOutput.match(/\[tier: (.*?)\]/);
        if (tierMatch) userData.tier = tierMatch[1];
        
        await userData.save();

        // 3. CLEANUP & REPLY
        let displayContent = rawOutput.replace(/\[.*?\]/g, '').trim();
        await message.reply({ content: displayContent || 'm-mm..', files });

        // 4. TTS (DAVE SECURE)
        const conn = getVoiceConnection(message.guild.id);
        if (conn && displayContent) {
            const player = createAudioPlayer();
            conn.subscribe(player);
            player.play(createAudioResource(googleTTS.getAudioUrl(displayContent, { lang: 'en' })));
        }

    } catch (e) { console.error("Neural Error:", e); }
});

client.login(process.env.TOKEN);