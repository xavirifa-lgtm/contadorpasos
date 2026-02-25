/**
 * Gemini AI Integration with Fallback logic
 */

const MODEL_LIST = [
    'gemini-3-flash',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2-flash'
];

export async function analyzeMeterPhoto(base64Image, apiKey, onStatusUpdate) {
    let lastError = null;

    for (const modelId of MODEL_LIST) {
        try {
            if (onStatusUpdate) onStatusUpdate(`Intentando con ${modelId}...`);

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: "Eres un experto en lectura de contadores eléctricos. Lee el número que aparece en la pantalla del contador de esta imagen. Devuelve SOLO el número, sin nada más de texto. Si hay varios números, dame el principal que indica el consumo total en kW/h." },
                            { inline_data: { mime_type: "image/jpeg", data: base64Image } }
                        ]
                    }]
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.warn(`Error en modelo ${modelId}:`, errorData);
                if (response.status === 429 || response.status === 404) {
                    continue; // Fallback to next model
                }
                throw new Error(errorData.error?.message || 'Error en la API de Gemini');
            }

            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!text) throw new Error('No se pudo extraer texto de la imagen');

            const reading = parseFloat(text.replace(/[^0-9.]/g, ''));
            if (isNaN(reading)) throw new Error('El valor leído no es un número válido');

            return { reading, modelUsed: modelId };

        } catch (err) {
            console.error(`Falló ${modelId}:`, err);
            lastError = err;
        }
    }

    throw lastError || new Error('Todos los modelos de IA fallaron');
}
