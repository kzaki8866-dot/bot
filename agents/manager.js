const { ChatGroq } = require("@langchain/groq");

module.exports = class Manager {
    constructor(apiKey) {
        this.model = new ChatGroq({ 
            apiKey: apiKey, 
            modelName: "llama-3.3-70b-versatile",
            model: "llama-3.3-70b-versatile",
            temperature: 0 // Set to 0 for pure logic
        });
    }

    async route(userInput, mindset) {
        const decisionPrompt = `
        You are a binary strategic router. 
        CONTEXT: ${mindset}
        USER_INPUT: "${userInput}"

        CRITICAL: You do not have a personality. You do not talk to the user.
        If the user asks for real-time info (price, news, weather, current events): 
        Output ONLY: REQUEST_SEARCH(specific search query)
        
        Otherwise: 
        Output ONLY: PROCESS_CONVERSATION
        `;

        try {
            const response = await this.model.invoke([["system", decisionPrompt]]);
            return response.content.trim();
        } catch (err) {
            return "PROCESS_CONVERSATION";
        }
    }
};