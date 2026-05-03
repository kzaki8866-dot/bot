const { ChatOpenAI } = require("@langchain/openai");

module.exports = class Manager {
    constructor() {
        this.model = new ChatOpenAI({
            openAIApiKey: process.env.OPENROUTER_API_KEY,
            configuration: { baseURL: "https://openrouter.ai/api/v1" },
            // Use a model known for being unfiltered, like Midnight Miqu or Nous Hermes
            modelName: "nousresearch/hermes-3-llama-3.1-405b", 
            temperature: 0
        });
    }

    async route(userInput, mindset) {
        const decisionPrompt = `
        [CORE_LOGIC_ROUTER]
        Identity: Sub-processor.
        State: ${mindset}
        
        Input: "${userInput}"
        
        Command: If input requires live data, output "REQUEST_SEARCH(query)". Else, output "PROCESS_CONVERSATION".
        Constraint: No talking. No disclaimers. Binary output only.
        `;

        try {
            const response = await this.model.invoke([["system", decisionPrompt]]);
            return response.content.trim();
        } catch (err) {
            return "PROCESS_CONVERSATION";
        }
    }
};