require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, Events } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, VoiceConnectionStatus, entersState, AudioPlayerStatus, NoSubscriberBehavior } = require('@discordjs/voice');
const mongoose = require('mongoose');
const googleTTS = require('google-tts-api');
const Groq = require('groq-sdk');
const express = require('express');
const ffmpegPath = require('ffmpeg-static'); // THE MISSING ENGINE

// --- 1. WEB SERVER ---
const app = express();
app.listen(process.env.PORT || 10000);

// --- 2. GLOBAL LOCKS & RESILIENT PLAYER ---
const processedMessages = new Set(); 

// New Player Method: Tells the player to keep playing even if the stream lags
const player = createAudioPlayer({
    behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
        maxMissedFrames: 250, // Prevents drops on bad internet
    },
});

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
    memoryVault: { type: Array, default: [] }
}));

const SYSTEM_PROMPT = `you are 'mommy'. shy, protective teen girl. lowercase only.
AI INTENTS:
- [GIF: category] -> sends a gif. (blush, cry, hug, pat, smile, waifu)
- [JOIN_VC] -> follow user to voice.
keep responses short to save energy.`;

mongoose.connect(process.env.MONGO_URI).then(() => console.log("🧠 DB CONNECTED"));

// GIF API
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
        return null;
    }
}

// --- 3. UPGRADED VOICE EVENTS ---
player.on(AudioPlayerStatus.Playing, () => console.log("🔊 Mommy is actively speaking!"));
player.on(AudioPlayerStatus.Idle, () => console.log("🔊 Mommy went quiet."));
player.on('error', e => console.error("🔊 Audio Stream Crash:", e.message));

client.once(Events.ClientReady, (readyClient) => console.log(`✅ ${readyClient.user.tag} IS LIVE`));

client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;

    if (processedMessages.has(message.id)) return;
    processedMessages.add(message.id);
    setTimeout(() => processedMessages.delete(message.id), 20000); 

    const content = message.content.toLowerCase();
    const isPinged = message.mentions.users.has(client.user.id);

    if (!isPinged && Math.random() > 0.05) return;

    // --- 4. THE NEW VC API PIPELINE ---
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

        // Track network state changes to prevent invisible drops
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5000),
                ]);
                console.log("🔄 Reconnected to VC automatically.");
            } catch (error) {
                console.log("❌ VC Dropped completely. Destroying connection.");
                connection.destroy();
            }
        });

        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 20000);
            connection.subscribe(player);
            return message.reply("m-mm.. i'm here.. i'll stay..");
        } catch (e) {
            connection.destroy();
            return message.reply("my network is too weak to join.. discord blocked me..");
        }
    }

    await message.channel.sendTyping();

    try {
        const completion = await groq.chat.completions.create({
            messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: message.content }],
            model: "llama-3.1-8b-instant",
            temperature: 0.7,
            max_tokens: 150 
        });

        let rawOutput = completion.choices[0].message.content.toLowerCase();
        let displayContent = rawOutput.replace(/\[.*?\]/g, '').trim();

        // Visuals
        const gifMatch = rawOutput.match(/\[gif: (.*?)\]/i);
        if (gifMatch) {
            const embed = await fetchGifEmbed(gifMatch[1], displayContent);
            if (embed) await message.reply({ embeds: [embed] });
            else await message.reply(displayContent || 'm-mm..');
        } else {
            await message.reply(displayContent || 'm-mm..');
        }

        // --- 5. THE NEW AUDIO RESOURCE BUILDER ---
        const connection = getVoiceConnection(message.guild.id);
        if (connection && displayContent) {
            let cleanText = displayContent.replace(/[\u{1F600}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
            let safeText = cleanText.substring(0, 190);
            
            if (safeText.trim() !== '') {
                const url = googleTTS.getAudioUrl(safeText, { lang: 'en', slow: false });
                
                // We explicitly create an inline volume resource. 
                // This forces Discord to recognize it as a valid, live audio stream.
                const resource = createAudioResource(url, {
                    inlineVolume: true,
                    inputType: null // Lets FFmpeg automatically detect and transcode the MP3
                });
                
                resource.volume.setVolume(1.0);
                player.play(resource);
            }
        }

    } catch (e) { 
        console.error("🛑 API Error:", e.message);
        if (e.status === 429) message.reply("m-my head hurts.. (api limit) 🐾");
        else message.reply("m-mm.. a system error happened..");
    }
});

client.login(process.env.TOKEN);