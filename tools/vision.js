module.exports = {
    name: "generate_image",
    description: "Create a visual image.",
    execute: async (prompt) => {
        return `https://pollinations.ai/p/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
    }
};