const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ACCESS_HASH_SECRET = process.env.ACCESS_HASH_SECRET || process.env.SUPABASE_ANON_KEY || "primor-access";

function obterIp(req) {
    const vercelIp = req.headers["x-real-ip"];
    const forwarded = req.headers["x-forwarded-for"];
    const ip = Array.isArray(vercelIp) ? vercelIp[0] : vercelIp;

    if (ip) return String(ip).trim();
    if (forwarded) return String(Array.isArray(forwarded) ? forwarded[0] : forwarded).split(",")[0].trim();

    return req.socket?.remoteAddress || "unknown";
}

function gerarHash(valor) {
    return crypto
        .createHash("sha256")
        .update(`${ACCESS_HASH_SECRET}:${valor}`)
        .digest("hex");
}

function obterBody(req) {
    if (!req.body) return {};
    if (typeof req.body === "object") return req.body;

    try {
        return JSON.parse(req.body);
    } catch (error) {
        return {};
    }
}

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ ok: false });
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        return res.status(200).json({ ok: false, reason: "missing_config" });
    }

    try {
        const ipHash = gerarHash(obterIp(req));
        const userAgent = String(req.headers["user-agent"] || "").slice(0, 320);
        const userAgentHash = userAgent ? gerarHash(userAgent) : null;
        const body = obterBody(req);
        const page = String(body.page || req.headers.referer || "/").slice(0, 220);

        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/registrar_acesso_catalogo`, {
            method: "POST",
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                p_visitante_hash: ipHash,
                p_pagina: page,
                p_user_agent_hash: userAgentHash
            })
        });

        if (!response.ok) {
            return res.status(200).json({ ok: false, reason: "rpc_unavailable" });
        }

        return res.status(200).json({ ok: true });
    } catch (error) {
        return res.status(200).json({ ok: false });
    }
};
