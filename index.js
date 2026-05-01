require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, Events } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, VoiceConnectionStatus, entersState, AudioPlayerStatus } = require('@discordjs/voice');
const mongoose = require('mongoose');
const googleTTS = require('google-tts-api');
const Groq = require('groq-sdk');
const express = require('express');

// --- 1. WEB SERVER ---
const app = express();
app.listen(process.env.PORT || 10000);

// --- 2. GLOBAL LOCKS & PLAYER ---
const processedMessages = new Set(); 
const player = createAudioPlayer();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ] 
});

// --- 3. DATABASE ---
const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    memoryVault: { type: Array, default: [] }
}));

const SYSTEM_PROMPT = `you are 'mommy'. shy, protective teen girl. lowercase only.
AI INTENTS & RULES:
- [GIF: category] -> sends a gif. categories u can use: blush, cry, hug, pat, smile, waifu.
- [JOIN_VC] -> follow user to voice.
- [SAVE: fact] -> remember something.
keep responses under 2 sentences to save energy.`;

mongoose.connect(process.env.MONGO_URI).then(() => console.log("🧠 DB CONNECTED"));

// --- 4. WAIFU GIF API (NO FILES NEEDED) ---
async function fetchGifEmbed(category, textContent) {
    try {
        const validCategories = ['blush', 'cry', 'hug', 'pat', 'smile', 'waifu'];
        const safeCategory = validCategories.includes(category) ? category : 'waifu';
        
        const response = await fetch(`https://api.waifu.pics/sfw/${safeCategory}`);
        const data = await response.json();

        return new EmbedBuilder()
            .setColor('#FFB6C1') 
            .setDescription(textContent || "m-mm..")
            .setImage(data.url); 
    } catch (e) {
        console.error("GIF API Error:", e);
        return null;
    }
}

// --- 5. VOICE EVENTS ---
player.on(AudioPlayerStatus.Idle, () => console.log("🔊 Finished speaking."));
player.on('error', e => console.error("🔊 Audio Error:", e.message));

client.once(Events.ClientReady, (readyClient) => console.log(`✅ ${readyClient.user.tag} IS LIVE`));

client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;

    // --- 6. IRONCLAD ANTI-DOUBLE ---
    if (processedMessages.has(message.id)) return;
    processedMessages.add(message.id);
    setTimeout(() => processedMessages.delete(message.id), 20000); 

    const content = message.content.toLowerCase();
    const isPinged = message.mentions.users.has(client.user.id);

    // --- 7. THE 5% / 100% RULE ---
    if (!isPinged && Math.random() > 0.05) return;

    // --- 8. BULLETPROOF VC JOIN ---
    const joinTriggers = ['join vc', 'come here', 'mommy join'];
    if (joinTriggers.some(t => content.includes(t))) {
        const channel = message.member.voice.channel;
        if (!channel) return message.reply("u-um.. u need to be in a vc first.. 🐾");

        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
            selfDeaf: false,
        });

        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 20000);
            connection.subscribe(player);
            return message.reply("m-mm.. i'm here.. i'll stay..");
        } catch (e) {
            connection.destroy();
            return message.reply("i can't connect.. discord is blocking me..");
        }
    }

    await message.channel.sendTyping();

    try {
        let userData = await User.findOne({ userId: message.author.id });
        if (!userData) userData = await User.create({ userId: message.author.id });

        // --- 9. THE MODEL FIX (llama-3.1-8b-instant) ---
        const completion = await groq.chat.completions.create({
            messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: message.content }],
            model: "llama-3.1-8b-instant", // THE STABLE, LIVE MODEL
            temperature: 0.7,
            max_tokens: 150 
        });

        let rawOutput = completion.choices[0].message.content.toLowerCase();
        let displayContent = rawOutput.replace(/\[.*?\]/g, '').trim();

        // --- THE GIF SYSTEM ---
        const gifMatch = rawOutput.match(/\[gif: (.*?)\]/i);
        
        if (gifMatch) {
            const embed = await fetchGifEmbed(gifMatch[1], displayContent);
            if (embed) {
                await message.reply({ embeds: [embed] });
            } else {
                await message.reply(displayContent || 'm-mm..');
            }
        } else {
            await message.reply(displayContent || 'm-mm..');
        }

        // --- 10. CRASH-PROOF TTS ---
        const connection = getVoiceConnection(message.guild.id);
        if (connection && displayContent) {
            // Strip emojis so Google TTS doesn't silently crash
            let cleanText = displayContent.replace(/[\u{1F600}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
            let safeText = cleanText.length > 190 ? cleanText.substring(0, 190) + "..." : cleanText;
            
            try {
                if (safeText.trim() !== '') {
                    const url = googleTTS.getAudioUrl(safeText, { lang: 'en', slow: false });
                    player.play(createAudioResource(url));
                }
            } catch (ttsError) { 
                console.error("TTS Failed silently:", ttsError.message); 
            }
        }

    } catch (e) { 
        console.error("🛑 API Error:", e);
        if (e.message?.includes('decommissioned')) {
            message.reply("my brain is broken.. model missing..");
        } else if (e.status === 429) {
            message.reply("m-my head hurts.. (api limit reached) 🐾");
        } else {
            message.reply("m-mm.. a system error happened..");
        }
    }
});

client.login(process.env.TOKEN);