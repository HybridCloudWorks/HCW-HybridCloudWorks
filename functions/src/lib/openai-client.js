/**
 * Azure OpenAI client helpers.
 *
 * Replaces GCP Vertex AI and Imagen 4.
 */

import { OpenAIClient, AzureKeyCredential } from "@azure/openai";

let openaiClient = null;

export function getOpenAIClient() {
  if (openaiClient) return openaiClient;

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const key = process.env.AZURE_OPENAI_KEY;

  if (!endpoint || !key) {
    throw new Error('Missing AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_KEY');
  }

  openaiClient = new OpenAIClient(endpoint, new AzureKeyCredential(key));
  return openaiClient;
}

/**
 * Generate text using GPT-4o
 * 
 * @param {string} prompt 
 * @param {object} options
 * @returns {Promise<string>}
 */
export async function generateText(prompt, options = {}) {
  const client = getOpenAIClient();
  const deploymentId = process.env.AZURE_OPENAI_GPT_DEPLOYMENT || 'gpt-4o';

  const messages = [
    { role: "system", content: options.systemInstruction || "You are a helpful assistant." },
    { role: "user", content: prompt }
  ];

  const result = await client.getChatCompletions(deploymentId, messages, {
    temperature: options.temperature || 0.7,
    maxTokens: options.maxTokens || 1000
  });

  return result.choices[0].message.content;
}

/**
 * Generate an image using DALL-E 3
 * 
 * @param {string} prompt 
 * @returns {Promise<string>} Image URL
 */
export async function generateImage(prompt) {
  const client = getOpenAIClient();
  const deploymentId = process.env.AZURE_OPENAI_DALLE_DEPLOYMENT || 'dall-e-3';

  const result = await client.getImages(deploymentId, prompt, {
    n: 1,
    size: "1024x1024"
  });

  return result.data[0].url;
}
