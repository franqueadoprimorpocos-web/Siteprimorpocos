const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env");

if (fs.existsSync(envPath)) {
    const localEnv = fs.readFileSync(envPath, "utf8");
    localEnv.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;

        const separator = trimmed.indexOf("=");
        if (separator === -1) return;

        const key = trimmed.slice(0, separator).trim();
        const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
        if (key && !process.env[key]) process.env[key] = value;
    });
}

const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];
const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
    throw new Error(`Variáveis ausentes: ${missing.join(", ")}`);
}

const env = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
};

const output = `window.PRIMOR_ENV = ${JSON.stringify(env, null, 4)};\n`;
const outputPath = path.join(__dirname, "..", "assets", "js", "env.js");

fs.writeFileSync(outputPath, output, "utf8");
console.log(`Configuração pública gerada em ${outputPath}`);
