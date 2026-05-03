const { AttachmentBuilder } = require('discord.js');

module.exports = {
    definition: {
        type: "function",
        function: {
            name: "generate_image",
            description: "Generate a picture to show the user.",
            parameters: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] }
        }
    },
    async execute(args, userId, messageContext) {
        const url = `https://pollinations.ai/p/${encodeURIComponent(args.prompt)}?width=1024&height=1024&nologo=true`;
        messageContext.files_to_send.push(new AttachmentBuilder(url, { name: 'vision.jpg' }));
        return "Image generated and queued for sending.";
    }
};