require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, NoSubscriberBehavior } = require('@discordjs/voice');
const mongoose = require('mongoose');
const gtts = require('gtts');
const fs = require('fs');
const Groq = require('groq-sdk');
const express = require('express');

// --- WEB SERVER (For Render) ---
const app = express();
app.get('/', (req, res) => res.send('dollhouse is cozy 🎀'));
app.listen(process.env.PORT || 8080);

// --- DB SETUP ---
const UserSchema = new mongoose.Schema({
    userId: String,
    memory: String,
    behaviorScore: { type: Number, default: 0 }
});
const User = mongoose.model('User', UserSchema);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers
    ]
});

const SYSTEM_PROMPT = "you are a shy, cute, but vulgar teen comgirl. type in lowercase. use stutters. you are bipolar: cute uwu girl vs vulgar mean girl. use slang like slay, fr, stfu. never admit you are an ai.";

// --- DB CONNECTION ---
if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI).then(() => console.log("🧠 Memory Linked")).catch(err => console.error("DB Error:", err));
}

client.once('clientReady', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    client.user.setActivity('u sleep.. 🐾', { type: ActivityType.Watching });
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // 1. MEMORY SYSTEM
    let userData = { memory: "stranger", behaviorScore: 0 };
    if (mongoose.connection.readyState === 1) {
        userData = await User.findOne({ userId: message.author.id }) || await User.create({ userId: message.author.id });
    }

    // 2. IMAGE GEN COMMAND
    if (message.content.toLowerCase().startsWith('send pic')) {
        const topic = message.content.split(' ').slice(2).join(' ') || 'pink aesthetic';
        const url = `https://pollinations.ai/p/${encodeURIComponent(topic)}?width=1024&height=1024&seed=${Math.floor(Math.random() * 9999)}`;
        return message.reply({ content: "h-here.. dumbass.. 🎀", files: [url] });
    }

    // 3. VOICE JOIN COMMAND
    if (message.content === 'come here') {
        if (!message.member.voice.channel) return message.reply("get in a vc first.. 🐾");
        joinVoiceChannel({
            channelId: message.member.voice.channel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
        });
        return message.reply("m-mm.. okay..");
    }

    // 4. CHAT LOGIC
    const isPinged = message.mentions.has(client.user);
    if (!isPinged && Math.random() > 0.10) return;

    await message.channel.sendTyping();

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: `${SYSTEM_PROMPT} Memory: ${userData.memory}` },
                { role: "user", content: message.content }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 1.1
        });

        const aiText = chatCompletion.choices[0].message.content.toLowerCase();
        
        // AUTO-NICKNAME (If she likes you)
        if (aiText.includes("good boy") && message.guild.members.me.permissions.has("ManageNicknames")) {
            message.member.setNickname("🎀 shy's favorite").catch(() => {});
        }

        await message.reply(aiText);

        // SPEAK IN VC (TTS)
        const connection = require('@discordjs/voice').getVoiceConnection(message.guild.id);
        if (connection) {
            const speech = new gtts(aiText, 'en');
            const filePath = `./voice.mp3`;
            speech.save(filePath, () => {
                const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
                const resource = createAudioResource(fs.createReadStream(filePath));
                connection.subscribe(player);
                player.play(resource);
            });
        }
    } catch (e) { console.error(e); }
});

client.login(process.env.TOKEN);