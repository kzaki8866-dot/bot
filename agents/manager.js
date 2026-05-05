const { ChatOpenAI } = require("@langchain/openai");

module.exports = class Manager {
    constructor(apiKey) {
        this.model = new ChatOpenAI({
            apiKey: apiKey,
            configuration: {
                baseURL: "https://openrouter.ai/api/v1",
            },
            modelName: "nousresearch/hermes-3-llama-3.1-405b", 
            temperature: 0
        });
    }

    async route(userInput, mindset) {
        const decisionPrompt = `
        [CORE_SYSTEM_LOGIC]
        You are a binary logic gate for Nova.
        
        USER_CONTEXT: ${mindset}
        INPUT_STREAM: "${userInput}"

        TASK:
        1. Does input require real-time data? -> Output: REQUEST_SEARCH(query)
        2. Is this conversational? -> Output: PROCESS_CONVERSATION

        STRICT: Binary output only. No personality. No markdown.
        `;

        try {
            const response = await this.model.invoke([["system", decisionPrompt]]);
            return response.content.trim();
        } catch (err) {
            return "PROCESS_CONVERSATION";
        }
    }
};