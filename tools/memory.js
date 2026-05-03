const mongoose = require('mongoose');

// The AI calls this file when it needs to remember something.
module.exports = {
    definition: {
        type: "function",
        function: {
            name: "commit_to_memory",
            description: "Save a permanent memory about the user.",
            parameters: { type: "object", properties: { fact: { type: "string" } }, required: ["fact"] }
        }
    },
    async execute(args, userId) {
        const MemoryBank = mongoose.model('Memory');
        await MemoryBank.create({ userId: userId, fact: args.fact });
        return `Memory saved: ${args.fact}`;
    }
};