const axios = require('axios');

module.exports = {
    name: "Researcher",
    async performSearch(query) {
        try {
            console.log(`[RE-SEARCH] Investigating: ${query}`);
            const res = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
            // Extracting only the top result snippets
            const results = res.data.match(/<a class="result__snippet[^>]*>(.*?)<\/a>/gi);
            
            if (!results) return "No live intelligence found for this query.";
            
            // Clean up the top 3 results
            return results.slice(0, 3)
                .map(r => r.replace(/<[^>]*>/g, ""))
                .join("\n---\n");
        } catch (err) {
            return "Intelligence gathering failed due to network interference.";
        }
    }
};