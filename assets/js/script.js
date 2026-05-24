// CONFIGURAÇÕES DO SUPABASE
const SUPABASE_URL = window.PRIMOR_ENV?.SUPABASE_URL || ""; 
const SUPABASE_ANON_KEY = window.PRIMOR_ENV?.SUPABASE_ANON_KEY || "";
const SUPABASE_CONFIG_OK = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const numeroAtendimento = "5535999638019"; // Seu WhatsApp de atendimento
const CLIENTES_API_ATIVA = true; // Execute supabase/sql/primor_rls_producao.sql no Supabase antes de publicar em producao

const headers = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json"
};
if (!SUPABASE_CONFIG_OK) {
    console.error("Configuração do Supabase ausente. Gere assets/js/env.js pelo build ou configure as variáveis na Vercel.");
}

async function registrarAcessoCatalogo() {
    if (!document.getElementById("product-list")) return;
    if (sessionStorage.getItem("primor_acesso_registrado") === dataISOHoje()) return;

    try {
        const response = await fetch("/api/track-access", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                page: window.location.pathname || "/"
            }),
            keepalive: true
        });

        if (response.ok) {
            sessionStorage.setItem("primor_acesso_registrado", dataISOHoje());
        }
    } catch (error) {
        // A medicao nunca deve atrapalhar o catalogo.
    }
}

function formatarNumeroMetrica(valor) {
    return Number(valor || 0).toLocaleString("pt-BR");
}

function formatarDataMetrica(valor) {
    if (!valor) return "Sem registros";

    try {
        return new Intl.DateTimeFormat("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        }).format(new Date(valor));
    } catch (error) {
        return "Sem registros";
    }
}

async function carregarResumoAcessosAdmin() {
    const container = document.getElementById("admin-resumo-acessos");
    if (!container) return;

    const senhaAdmin = sessionStorage.getItem("admin_senha") || "";
    if (!senhaAdmin) {
        container.innerHTML = "";
        return;
    }

    container.innerHTML = "<p>Carregando acessos do catalogo...</p>";

    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/resumo_acessos_admin`, {
            method: "POST",
            headers,
            body: JSON.stringify({ p_senha: senhaAdmin })
        });

        if (!response.ok) throw new Error("Resumo de acessos indisponivel.");

        const dados = await response.json();
        const resumo = Array.isArray(dados) ? dados[0] : dados;

        container.innerHTML = `
            <div class="admin-access-copy">
                <span>Movimento do catalogo</span>
                <strong>Visitantes unicos por dia</strong>
                <small>Contagem por hash anonimo. Nao salvamos IP puro nem dados pessoais.</small>
            </div>
            <div class="admin-access-metrics">
                <div><strong>${formatarNumeroMetrica(resumo?.hoje)}</strong><span>Hoje</span></div>
                <div><strong>${formatarNumeroMetrica(resumo?.ultimos_7_dias)}</strong><span>7 dias</span></div>
                <div><strong>${formatarNumeroMetrica(resumo?.ultimos_30_dias)}</strong><span>30 dias</span></div>
                <div><strong>${formatarNumeroMetrica(resumo?.total)}</strong><span>Total</span></div>
                <div><strong>${formatarDataMetrica(resumo?.ultima_visita)}</strong><span>Ultima visita</span></div>
            </div>
        `;
    } catch (error) {
        container.innerHTML = "<p>Rode o SQL atualizado no Supabase para ativar as metricas de acesso.</p>";
    }
}


let cacheProdutos = []; // Mantém produtos em memória para filtros rápidos
let cacheProdutosAdmin = [];
let cacheGruposAdmin = new Map();
let perfumeSelecionadoParaWhatsApp = "";
let marcaSelecionadaParaWhatsApp = "";
let clienteAtual = carregarClienteLocal();
let marcaSelecionadaCatalogo = "";
let filtroEspecialCatalogo = "";
let scrollMenuMobile = 0;
let suporteCampoNovidade = false;
let suporteCamposDisponibilidade = false;
let marcaLateralAdmin = "";
let statusLateralAdmin = "";

const supabaseClient = window.supabase?.createClient
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

function escaparHTML(valor) {
    return String(valor ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function escaparAtributoJS(valor) {
    return String(valor ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "\\'")
        .replace(/\n/g, " ")
        .replace(/\r/g, " ");
}

function normalizarImagemProduto(imagem) {
    const url = String(imagem ?? "").trim();

    if (!url || /via\.placeholder\.com|placeholder\.com|Sem\+Foto/i.test(url)) {
        return "";
    }

    return url;
}

function obterMarcaProduto(produto) {
    return String(produto.marca ?? "").trim() || "Não classificado";
}

function produtoEhDestaque(produto) {
    return produto?.destaque === true || produto?.destaque === "true";
}

function dataISOHoje() {
    return new Date().toISOString().slice(0, 10);
}

function adicionarDiasISO(dias) {
    const data = new Date();
    data.setDate(data.getDate() + Number(dias || 0));
    return data.toISOString().slice(0, 10);
}

function obterDataISO(valor) {
    const texto = String(valor ?? "").trim();
    if (!texto) return "";
    return texto.slice(0, 10);
}

function obterNovidadeAte(produto) {
    return obterDataISO(produto?.novidade_ate);
}

function produtoEhNovidade(produto) {
    const marcado = produto?.novidade === true || produto?.novidade === "true";
    if (!marcado) return false;

    const novidadeAte = obterNovidadeAte(produto);
    return !novidadeAte || novidadeAte >= dataISOHoje();
}

function produtoEsgotado(produto) {
    return produto?.esgotado === true || produto?.esgotado === "true";
}

function produtoSobDemanda(produto) {
    return produto?.sob_demanda === true || produto?.sob_demanda === "true";
}

function obterPrazoReposicao(produto) {
    return String(produto?.prazo_reposicao ?? "").trim();
}

function chaveProduto(produto) {
    const nome = obterNomeBaseProduto(produto).toLowerCase().trim().replace(/\s+/g, " ");
    const marca = obterMarcaProduto(produto).toLowerCase().trim().replace(/\s+/g, " ");
    return `${nome}::${marca}`;
}

function obterVolumeProduto(produto) {
    const nome = String(produto.nome ?? "");
    const match = nome.match(/(\d{1,3})\s*(?:ml|m[l1i])\b/i);
    return match ? Number(match[1]) : null;
}

function obterNomeBaseProduto(produto) {
    return String(produto.nome ?? "")
        .replace(/\b\d{1,3}\s*(?:ml|m[l1i])\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
}

function obterVolumesGrupo(produto) {
    const volumes = (produto._volumes || [])
        .map(Number)
        .filter(volume => Number.isFinite(volume) && volume > 0)
        .sort((a, b) => a - b);

    return [...new Set(volumes)];
}

function compararTextoPtBr(a, b) {
    return String(a ?? "").localeCompare(String(b ?? ""), "pt-BR", {
        sensitivity: "base",
        numeric: true
    });
}

function agruparProdutosPorPerfume(produtos) {
    const grupos = new Map();

    produtos.forEach(produto => {
        const chave = chaveProduto(produto);
        if (!chave || chave === "::nao classificado") return;

        const existente = grupos.get(chave);
        const volume = obterVolumeProduto(produto);

        if (!existente) {
            grupos.set(chave, {
                ...produto,
                nome: obterNomeBaseProduto(produto) || produto.nome,
                _variacoes: [produto],
                _volumes: volume ? [volume] : []
            });
            return;
        }

        existente._variacoes.push(produto);
        if (volume) existente._volumes.push(volume);
        if (!normalizarImagemProduto(existente.imagem) && normalizarImagemProduto(produto.imagem)) existente.imagem = produto.imagem;
        if (!existente.notas && produto.notas) existente.notas = produto.notas;
        if (!produtoEhDestaque(existente) && produtoEhDestaque(produto)) {
            existente.destaque = produto.destaque;
        }
        if (!produtoEhNovidade(existente) && produtoEhNovidade(produto)) {
            existente.novidade = produto.novidade;
            existente.novidade_ate = produto.novidade_ate;
        }
        if (!produtoEsgotado(existente) && produtoEsgotado(produto)) existente.esgotado = produto.esgotado;
        if (!produtoSobDemanda(existente) && produtoSobDemanda(produto)) existente.sob_demanda = produto.sob_demanda;
        if (!obterPrazoReposicao(existente) && obterPrazoReposicao(produto)) existente.prazo_reposicao = produto.prazo_reposicao;
    });

    return [...grupos.values()];
}

function removerDuplicados(produtos) {
    const vistos = new Set();

    return produtos.filter(produto => {
        const chave = chaveProduto(produto);
        if (!chave || chave === "::nao classificado" || vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
    });
}

function tratarErroImagem(img) {
    const container = img ? img.parentElement : null;
    if (container) container.classList.add("sem-imagem");
    if (img) {
        img.onerror = null;
        img.remove();
    }
}

function detectarAreaVisualImagem(img) {
    const larguraNatural = img.naturalWidth;
    const alturaNatural = img.naturalHeight;
    const limite = 360;
    const escalaCanvas = Math.min(1, limite / Math.max(larguraNatural, alturaNatural));
    const larguraCanvas = Math.max(1, Math.round(larguraNatural * escalaCanvas));
    const alturaCanvas = Math.max(1, Math.round(alturaNatural * escalaCanvas));
    const canvas = document.createElement("canvas");
    const contexto = canvas.getContext("2d", { willReadFrequently: true });

    if (!contexto) return null;

    canvas.width = larguraCanvas;
    canvas.height = alturaCanvas;
    contexto.drawImage(img, 0, 0, larguraCanvas, alturaCanvas);

    const { data } = contexto.getImageData(0, 0, larguraCanvas, alturaCanvas);
    const amostras = [
        [0, 0],
        [larguraCanvas - 1, 0],
        [0, alturaCanvas - 1],
        [larguraCanvas - 1, alturaCanvas - 1]
    ].map(([x, y]) => {
        const i = (y * larguraCanvas + x) * 4;
        return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    });

    const fundo = amostras.reduce((acc, cor) => {
        acc[0] += cor[0];
        acc[1] += cor[1];
        acc[2] += cor[2];
        acc[3] += cor[3];
        return acc;
    }, [0, 0, 0, 0]).map(valor => valor / amostras.length);

    let minX = larguraCanvas;
    let minY = alturaCanvas;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < alturaCanvas; y += 1) {
        for (let x = 0; x < larguraCanvas; x += 1) {
            const i = (y * larguraCanvas + x) * 4;
            const alpha = data[i + 3];
            if (alpha < 18) continue;

            const dr = data[i] - fundo[0];
            const dg = data[i + 1] - fundo[1];
            const db = data[i + 2] - fundo[2];
            const da = alpha - fundo[3];
            const distancia = Math.sqrt(dr * dr + dg * dg + db * db + da * da * 0.35);

            if (distancia < 28 && alpha > 235) continue;

            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
    }

    if (maxX < minX || maxY < minY) return null;

    const margemX = Math.round(larguraCanvas * 0.025);
    const margemY = Math.round(alturaCanvas * 0.025);
    minX = Math.max(0, minX - margemX);
    minY = Math.max(0, minY - margemY);
    maxX = Math.min(larguraCanvas - 1, maxX + margemX);
    maxY = Math.min(alturaCanvas - 1, maxY + margemY);

    const larguraVisual = (maxX - minX + 1) / escalaCanvas;
    const alturaVisual = (maxY - minY + 1) / escalaCanvas;
    const areaVisual = larguraVisual * alturaVisual;
    const areaTotal = larguraNatural * alturaNatural;

    if (areaVisual < areaTotal * 0.08) return null;

    return {
        x: minX / escalaCanvas,
        y: minY / escalaCanvas,
        largura: larguraVisual,
        altura: alturaVisual
    };
}

function aplicarMedidasImagemCatalogo(img, areaVisual = null) {
    if (!img || !img.naturalWidth || !img.naturalHeight) return;

    const container = img.closest(".image-container");
    if (!container) return;

    const largura = img.naturalWidth;
    const altura = img.naturalHeight;
    const pixels = largura * altura;
    const larguraBox = container.clientWidth || 260;
    const alturaBox = container.clientHeight || 220;
    const area = areaVisual || { x: 0, y: 0, largura, altura };
    const proporcaoVisual = area.largura / area.altura;
    const pixelsVisuais = Math.round(area.largura * area.altura);
    const larguraInterna = Math.max(120, larguraBox - 20);
    const alturaInterna = Math.max(140, alturaBox - 20);

    container.classList.remove("img-vertical", "img-horizontal", "img-equilibrada", "img-baixa-resolucao");
    img.classList.add("imagem-padronizada");

    let classe = "img-equilibrada";
    let ocupacaoLargura = 0.82;
    let ocupacaoAltura = 0.86;

    if (proporcaoVisual < 0.72) {
        classe = "img-vertical";
        ocupacaoLargura = 0.74;
        ocupacaoAltura = 0.9;
    } else if (proporcaoVisual > 1.34) {
        classe = "img-horizontal";
        ocupacaoLargura = 0.9;
        ocupacaoAltura = 0.72;
    }

    const escalaEncaixe = Math.min(
        (larguraInterna * ocupacaoLargura) / area.largura,
        (alturaInterna * ocupacaoAltura) / area.altura
    );
    const limiteUpscale = pixelsVisuais < 90000 ? 2.2 : pixelsVisuais < 180000 ? 1.7 : 1.35;
    const escalaFinal = Math.min(escalaEncaixe, limiteUpscale);
    const larguraRenderizada = Math.round(largura * escalaFinal);
    const alturaRenderizada = Math.round(altura * escalaFinal);
    const centroImagemX = largura / 2;
    const centroImagemY = altura / 2;
    const centroVisualX = area.x + area.largura / 2;
    const centroVisualY = area.y + area.altura / 2;
    const offsetX = Math.round((centroImagemX - centroVisualX) * escalaFinal);
    const offsetY = Math.round((centroImagemY - centroVisualY) * escalaFinal);

    container.classList.add(classe);
    container.classList.toggle("img-baixa-resolucao", pixelsVisuais < 90000);
    container.dataset.imagemPixels = String(pixels);
    container.dataset.imagemPixelsVisuais = String(pixelsVisuais);
    container.dataset.imagemProporcao = proporcaoVisual.toFixed(2);
    container.dataset.imagemMedida = areaVisual ? "area-visual" : "natural";

    img.style.setProperty("--img-render-width", `${larguraRenderizada}px`);
    img.style.setProperty("--img-render-height", `${alturaRenderizada}px`);
    img.style.setProperty("--img-offset-x", `${offsetX}px`);
    img.style.setProperty("--img-offset-y", `${offsetY}px`);
}

function tentarMedirImagemComCors(img) {
    if (!img?.src || img.dataset.medicaoCorsTentada === "true") return;
    const origemAtual = window.location.origin;
    const origemImagem = new URL(img.currentSrc || img.src, window.location.href).origin;
    if (origemImagem !== origemAtual) return;

    img.dataset.medicaoCorsTentada = "true";
    const probe = new Image();
    probe.crossOrigin = "anonymous";
    probe.onload = () => {
        try {
            const areaVisual = detectarAreaVisualImagem(probe);
            if (areaVisual) aplicarMedidasImagemCatalogo(img, areaVisual);
        } catch (error) {
            // Mantém a padronização por proporção quando o servidor bloqueia leitura dos pixels.
        }
    };
    probe.onerror = () => {};
    probe.src = img.currentSrc || img.src;
}

function padronizarImagemCatalogo(img) {
    if (!img || !img.naturalWidth || !img.naturalHeight) return;

    let areaVisual = null;
    try {
        areaVisual = detectarAreaVisualImagem(img);
    } catch (error) {
        areaVisual = null;
    }

    aplicarMedidasImagemCatalogo(img, areaVisual);
    if (!areaVisual) tentarMedirImagemComCors(img);
}

function padronizarImagensCatalogo(container = document) {
    container.querySelectorAll(".image-container img").forEach(img => {
        if (img.complete) padronizarImagemCatalogo(img);
    });
}

function atualizarResumoCatalogo(produtos = cacheProdutos) {
    const produtosUnicos = agruparProdutosPorPerfume(produtos);
    const marcas = new Set(produtosUnicos.map(produto => obterMarcaProduto(produto)).filter(Boolean));
    const comNotas = produtosUnicos.filter(produto => limparValorNulo(produto.notas)).length;
    const totalPerfumes = document.getElementById("preview-total-perfumes");
    const totalMarcas = document.getElementById("preview-total-marcas");
    const totalNotas = document.getElementById("preview-total-notas");

    if (totalPerfumes) totalPerfumes.textContent = String(produtosUnicos.length);
    if (totalMarcas) totalMarcas.textContent = String(marcas.size);
    if (totalNotas) totalNotas.textContent = String(comNotas);
}

function carregarClienteLocal() {
    try {
        return JSON.parse(localStorage.getItem("cliente_primor") || "{}");
    } catch (error) {
        return {};
    }
}

function salvarClienteLocal(cliente) {
    const dadosLimpos = {};
    Object.entries(cliente || {}).forEach(([chave, valor]) => {
        const valorLimpo = limparValorNulo(valor);
        if (valorLimpo !== null) dadosLimpos[chave] = valorLimpo;
    });

    if (dadosLimpos.nome) dadosLimpos.nome = formatarNomeCliente(dadosLimpos.nome);
    clienteAtual = { ...clienteAtual, ...dadosLimpos };
    localStorage.setItem("cliente_primor", JSON.stringify(clienteAtual));
    atualizarBotaoLoginCliente();
}

function normalizarTelefone(valor) {
    return String(valor ?? "").replace(/\D/g, "");
}

function formatarTelefonePreview(valor) {
    const telefone = normalizarTelefone(valor);
    const local = telefone.startsWith("55") && telefone.length > 11 ? telefone.slice(2) : telefone;

    if (local.length === 11) {
        return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
    }

    if (local.length === 10) {
        return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
    }

    return valor || "";
}

function normalizarCPF(valor) {
    const cpf = String(valor ?? "").replace(/\D/g, "");
    return cpf || null;
}

function normalizarEmail(valor) {
    return String(valor ?? "").trim().toLowerCase();
}

function capitalizarTextoHumano(valor) {
    return String(valor ?? "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .map(parte => {
            if (!parte) return "";
            if (["de", "da", "das", "do", "dos", "e"].includes(parte)) return parte;
            return parte
                .split("-")
                .map(subparte => subparte ? subparte.charAt(0).toUpperCase() + subparte.slice(1) : "")
                .join("-");
        })
        .join(" ");
}

function formatarNomeCliente(valor) {
    return capitalizarTextoHumano(valor);
}

function formatarMarcaMensagem(valor) {
    const texto = limparValorNulo(valor);
    return texto ? capitalizarTextoHumano(texto) : "";
}

function formatarPerfumeMensagem(valor) {
    return String(valor ?? "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

function montarDescricaoPerfumeMensagem() {
    const perfume = formatarPerfumeMensagem(perfumeSelecionadoParaWhatsApp);
    const marca = formatarMarcaMensagem(marcaSelecionadaParaWhatsApp);

    if (perfume && marca) return `${perfume}, da marca ${marca}`;
    return perfume || "selecionado no catálogo";
}

function clienteTemCadastroCompleto() {
    return cadastroClienteCompleto(clienteAtual);
}

function limparValorNulo(valor) {
    if (valor === undefined || valor === null) return null;
    const texto = String(valor).trim();
    return texto ? texto : null;
}

function dadosClienteFormulario(prefixo) {
    const emailFormulario = document.getElementById(`${prefixo}-email-form`)?.value || "";
    const emailLogin = document.getElementById(`${prefixo}-email`)?.value || "";

    return {
        nome: formatarNomeCliente(limparValorNulo(document.getElementById(`${prefixo}-nome`)?.value) || ""),
        email: normalizarEmail(emailFormulario || emailLogin),
        telefone: normalizarTelefone(document.getElementById(`${prefixo}-telefone`)?.value || ""),
        cpf: normalizarCPF(document.getElementById(`${prefixo}-cpf`)?.value),
        data_nascimento: limparValorNulo(document.getElementById(`${prefixo}-nascimento`)?.value)
    };
}

function preencherFormularioCliente(prefixo, cliente = clienteAtual) {
    const campos = {
        nome: document.getElementById(`${prefixo}-nome`),
        email: document.getElementById(`${prefixo}-email`) || document.getElementById(`${prefixo}-email-form`),
        telefone: document.getElementById(`${prefixo}-telefone`),
        cpf: document.getElementById(`${prefixo}-cpf`),
        data_nascimento: document.getElementById(`${prefixo}-nascimento`)
    };

    if (campos.nome) campos.nome.value = cliente.nome || "";
    if (campos.email) campos.email.value = cliente.email || "";
    const emailFormAlternativo = document.getElementById(`${prefixo}-email-form`);
    if (emailFormAlternativo) emailFormAlternativo.value = cliente.email || "";
    if (campos.telefone) campos.telefone.value = cliente.telefone || "";
    if (campos.cpf) campos.cpf.value = cliente.cpf || "";
    if (campos.data_nascimento) campos.data_nascimento.value = cliente.data_nascimento || "";

    if (prefixo === "cliente-login") atualizarPreviewCliente(cliente);
}

function definirFeedbackCliente(mensagem, tipo = "info") {
    const feedback = document.getElementById("cliente-feedback");
    if (!feedback) return;
    feedback.textContent = mensagem;
    feedback.dataset.tipo = tipo;
}

function alternarCarregamentoCliente(ativo, ids = []) {
    ids.forEach(id => {
        const botao = document.getElementById(id);
        if (botao) botao.disabled = ativo;
    });
}

function cadastroClienteCompleto(cliente = clienteAtual) {
    return Boolean(limparValorNulo(cliente.nome) && limparValorNulo(cliente.telefone));
}

function primeiroNomeCliente(cliente = clienteAtual) {
    const nome = limparValorNulo(cliente.nome);
    if (nome) return nome.split(/\s+/)[0];

    const email = limparValorNulo(cliente.email);
    if (email) return email.split("@")[0];

    return "";
}

function iniciaisCliente(nome) {
    const partes = String(nome || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2);

    return partes.length
        ? partes.map(parte => parte[0]).join("").toUpperCase()
        : "P";
}

function atualizarPreviewCliente(cliente = clienteAtual) {
    const avatar = document.getElementById("cliente-preview-avatar");
    const nomePreview = document.getElementById("cliente-preview-nome");
    const detalhePreview = document.getElementById("cliente-preview-detalhe");

    if (!avatar || !nomePreview || !detalhePreview) return;

    const clienteTela = {
        ...cliente,
        ...dadosClienteFormulario("cliente-login")
    };

    const nome = limparValorNulo(clienteTela.nome) || "Cliente Primor";
    const detalhe = formatarTelefonePreview(clienteTela.telefone)
        || limparValorNulo(clienteTela.email)
        || "Cadastro aguardando seus dados";

    avatar.textContent = iniciaisCliente(nome);
    nomePreview.textContent = nome;
    detalhePreview.textContent = detalhe;
}

function atualizarBotaoLoginCliente() {
    const botao = document.getElementById("login-nav-button");
    const botaoSair = document.getElementById("logout-nav-button");
    const botaoSairMobile = document.getElementById("logout-mobile-button");
    if (!botao) return;

    const nome = primeiroNomeCliente();
    if (nome) {
        botao.textContent = iniciaisCliente(nome).slice(0, 2);
        botao.dataset.logado = "true";
        botao.dataset.iniciais = iniciaisCliente(nome).slice(0, 2);
        botao.setAttribute("aria-label", `Abrir cadastro de ${nome}`);
        botao.title = nome;
        if (botaoSair) botaoSair.hidden = false;
        if (botaoSairMobile) botaoSairMobile.hidden = false;
        return;
    }

    botao.textContent = "CP";
    botao.dataset.logado = "false";
    botao.dataset.iniciais = "CP";
    botao.setAttribute("aria-label", "Abrir cadastro");
    botao.title = "Abrir cadastro do cliente";
    if (botaoSair) botaoSair.hidden = true;
    if (botaoSairMobile) botaoSairMobile.hidden = true;
}

function fecharMenuContaTemporariamente() {
    const menu = document.querySelector(".account-menu");
    if (!menu) return;
    menu.classList.add("account-menu-closed");
    document.activeElement?.blur?.();
}

function abrirPainelCliente() {
    fecharMenuContaTemporariamente();
    mostrarSecao("cliente");
}

function alternarEdicaoCliente(editar) {
    const secao = document.getElementById("secao-cliente");
    const botaoEditar = document.getElementById("cliente-editar-btn");
    if (!secao) return;

    secao.dataset.editando = editar ? "true" : "false";
    if (botaoEditar) botaoEditar.hidden = editar || !clienteTemCadastroCompleto();
}

function definirStatusCliente(cliente = clienteAtual) {
    const status = document.getElementById("cliente-auth-status");
    const secaoCliente = document.getElementById("secao-cliente");
    const botaoEditar = document.getElementById("cliente-editar-btn");
    atualizarBotaoLoginCliente();
    atualizarPreviewCliente(cliente);
    if (!status) return;

    if (cadastroClienteCompleto(cliente)) {
        const identificador = cliente.nome || cliente.email || cliente.telefone;
        status.innerHTML = `Logado como <strong>${escaparHTML(identificador)}</strong>`;
        status.dataset.estado = "ok";
        if (secaoCliente) {
            secaoCliente.dataset.clienteLogado = "true";
            if (secaoCliente.dataset.editando !== "true") secaoCliente.dataset.editando = "false";
        }
        if (botaoEditar) botaoEditar.hidden = secaoCliente?.dataset.editando === "true";
        return;
    }

    if (cliente.email || cliente.nome || cliente.telefone) {
        status.innerHTML = "Cadastro iniciado. Complete nome e telefone para liberar benefícios e agilizar encomendas.";
        status.dataset.estado = "pendente";
        if (secaoCliente) {
            secaoCliente.dataset.clienteLogado = "false";
            secaoCliente.dataset.editando = "true";
        }
        if (botaoEditar) botaoEditar.hidden = true;
        return;
    }

    status.textContent = "Preencha seu cadastro para facilitar descontos, encomendas e atendimento.";
    status.dataset.estado = "vazio";
    if (secaoCliente) {
        secaoCliente.dataset.clienteLogado = "false";
        secaoCliente.dataset.editando = "true";
    }
    if (botaoEditar) botaoEditar.hidden = true;
}

async function registrarCliente(cliente, origem, authUserId = null) {
    if (!CLIENTES_API_ATIVA) return false;

    const rpcPayload = {
        p_nome: limparValorNulo(cliente.nome),
        p_email: limparValorNulo(cliente.email),
        p_telefone: limparValorNulo(cliente.telefone),
        p_cpf: limparValorNulo(cliente.cpf),
        p_data_nascimento: limparValorNulo(cliente.data_nascimento),
        p_origem: origem,
        p_auth_user_id: authUserId || cliente.auth_user_id || null
    };

    try {
        const rpcResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_cliente_publico`, {
            method: "POST",
            headers,
            body: JSON.stringify(rpcPayload)
        });

        if (rpcResponse.ok) return true;
    } catch (error) {
        console.warn("Erro ao registrar cliente:", error);
    }

    return false;
}

function obterRedirectAtual() {
    return window.location.href.split("#")[0].split("?")[0];
}

async function aplicarSessaoCliente(session, origem = "login_auth") {
    if (!session?.user) {
        definirStatusCliente();
        return;
    }

    const user = session.user;
    const metadata = user.user_metadata || {};
    const cliente = {
        ...clienteAtual,
        auth_user_id: user.id,
        email: user.email || clienteAtual.email || "",
        nome: clienteAtual.nome || metadata.full_name || metadata.name || "",
        telefone: clienteAtual.telefone || metadata.phone || ""
    };

    salvarClienteLocal(cliente);
    preencherFormularioCliente("cliente-login", clienteAtual);
    preencherFormularioCliente("cliente", clienteAtual);
    definirStatusCliente(clienteAtual);

    await registrarCliente(clienteAtual, origem, user.id);
}

async function sincronizarClienteAutenticado() {
    if (!supabaseClient) {
        definirStatusCliente();
        return;
    }

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        await aplicarSessaoCliente(session, "login_auth");
    } catch (error) {
        console.warn("Não foi possível sincronizar login:", error);
        definirStatusCliente();
    }
}

function abrirModalCliente() {
    const modal = document.getElementById("modal-cliente");
    const emailModal = document.getElementById("cliente-acesso-email");
    const telefoneModal = document.getElementById("cliente-acesso-telefone");

    if (emailModal) emailModal.value = document.getElementById("cliente-login-email-form")?.value || clienteAtual.email || "";
    if (telefoneModal) telefoneModal.value = document.getElementById("cliente-login-telefone")?.value || clienteAtual.telefone || "";

    if (modal) {
        modal.style.display = "flex";
        window.setTimeout(() => (emailModal?.value ? telefoneModal : emailModal)?.focus(), 80);
    }
}

function fecharModalCliente(event) {
    if (event && event.target?.id !== "modal-cliente") return;
    const modal = document.getElementById("modal-cliente");
    if (modal) modal.style.display = "none";
}

async function buscarClientePorAcesso() {
    const emailAcesso = normalizarEmail(
        document.getElementById("cliente-acesso-email")?.value
        || document.getElementById("cliente-login-email")?.value
        || document.getElementById("cliente-login-email-form")?.value
        || ""
    );
    const telefoneAcesso = normalizarTelefone(
        document.getElementById("cliente-acesso-telefone")?.value
        || document.getElementById("cliente-login-telefone")?.value
        || ""
    );
    if (!emailAcesso && !telefoneAcesso) {
        definirFeedbackCliente("Informe e-mail ou telefone para acessar seu cadastro.", "erro");
        return null;
    }

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/buscar_cliente_publico`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            p_email: emailAcesso || null,
            p_telefone: telefoneAcesso || null
        })
    });

    if (!response.ok) throw new Error(await response.text());

    const clientes = await response.json();
    return clientes[0] || null;
}

async function acessarCadastroCliente() {
    definirFeedbackCliente("Buscando cadastro...", "info");
    alternarCarregamentoCliente(true, ["cliente-acessar-btn", "cliente-salvar-btn"]);

    try {
        const cliente = await buscarClientePorAcesso();

        if (!cliente) {
            if (!document.getElementById("cliente-feedback")?.textContent) {
                definirFeedbackCliente("Cadastro não encontrado. Preencha os dados e salve para criar um cadastro.", "erro");
            }
            return;
        }

        salvarClienteLocal(cliente);
        preencherFormularioCliente("cliente-login", clienteAtual);
        preencherFormularioCliente("cliente", clienteAtual);
        definirStatusCliente(clienteAtual);
        alternarEdicaoCliente(false);
        definirFeedbackCliente("Cadastro carregado neste dispositivo.", "sucesso");
        fecharModalCliente();
    } catch (error) {
        console.warn("Não foi possível acessar cadastro:", error);
        definirFeedbackCliente("Não foi possível buscar o cadastro agora.", "erro");
    } finally {
        alternarCarregamentoCliente(false, ["cliente-acessar-btn", "cliente-salvar-btn"]);
    }
}

async function loginEmailCliente() {
    const email = normalizarEmail(document.getElementById("cliente-login-email")?.value || document.getElementById("cliente-login-email-form")?.value || "");

    if (!email) {
        definirFeedbackCliente("Digite seu e-mail para receber o link de acesso.", "erro");
        return;
    }

    if (!supabaseClient) {
        definirFeedbackCliente("Biblioteca de vínculo não carregou. Verifique a conexão e tente novamente.", "erro");
        return;
    }

    definirFeedbackCliente("Enviando link de acesso...", "info");
    alternarCarregamentoCliente(true, ["cliente-acessar-btn", "cliente-email-btn", "cliente-salvar-btn"]);

    const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: {
            emailRedirectTo: obterRedirectAtual(),
            shouldCreateUser: true
        }
    });

    alternarCarregamentoCliente(false, ["cliente-acessar-btn", "cliente-email-btn", "cliente-salvar-btn"]);

    if (error) {
        alternarCarregamentoCliente(false, ["cliente-acessar-btn", "cliente-email-btn", "cliente-salvar-btn"]);
        definirFeedbackCliente(`Não foi possível enviar o link: ${error.message}`, "erro");
        return;
    }

    salvarClienteLocal({ ...clienteAtual, email });
    preencherFormularioCliente("cliente-login", clienteAtual);
    definirFeedbackCliente("Link enviado! Abra seu e-mail para confirmar o acesso.", "sucesso");
}


async function sairCliente() {
    if (supabaseClient) await supabaseClient.auth.signOut();
    localStorage.removeItem("cliente_primor");
    clienteAtual = {};
    preencherFormularioCliente("cliente-login", clienteAtual);
    preencherFormularioCliente("cliente", clienteAtual);
    definirStatusCliente(clienteAtual);
    alternarEdicaoCliente(true);
    atualizarBotaoLoginCliente();
    definirFeedbackCliente("Você saiu do cadastro neste dispositivo.", "info");
    fecharMenuMobile();
}

// ==========================================
// SEÇÕES E NAVEGAÇÃO
// ==========================================
function mostrarSecao(secaoId) {
    const secoes = document.querySelectorAll(".content-section");
    secoes.forEach(sec => sec.classList.remove("active"));

    const target = document.getElementById(`secao-${secaoId}`);
    if (target) {
        target.classList.add("active");
    }

    if (secaoId === 'home') {
        renderizarProdutos(cacheProdutos);
        atualizarMarcaAtiva("");
    }

    if (secaoId === 'catalogo') {
        renderizarProdutos(cacheProdutos);
    }

    fecharMenuMobile();
    if (document.activeElement !== document.getElementById("search")) fecharBuscaNav();
}

function abrirMenuMobile() {
    scrollMenuMobile = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.classList.add("menu-aberto");
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollMenuMobile}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
}

function fecharMenuMobile() {
    const estavaAberto = document.body.classList.contains("menu-aberto");
    document.body.classList.remove("menu-aberto");
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    if (estavaAberto) window.scrollTo(0, scrollMenuMobile || 0);
    document.querySelector(".dropdown.mobile-open")?.classList.remove("mobile-open");
    document.querySelector(".dropbtn[aria-expanded='true']")?.setAttribute("aria-expanded", "false");
}

function alternarMenuMarcasMobile(event) {
    if (window.innerWidth > 768) return;

    event.preventDefault();
    const dropdown = event.currentTarget.closest(".dropdown");
    if (!dropdown) return;

    const aberto = dropdown.classList.toggle("mobile-open");
    event.currentTarget.setAttribute("aria-expanded", String(aberto));
}

function atualizarMarcaAtiva(marca) {
    const termo = (marca || "").toLowerCase().trim();
    document.querySelectorAll(".brand-chip").forEach(chip => {
        const chipMarca = (chip.dataset.marca || "").toLowerCase().trim();
        const chipFiltro = (chip.dataset.filtro || "").toLowerCase().trim();
        const filtroAtivo = Boolean(filtroEspecialCatalogo) && chipFiltro === filtroEspecialCatalogo;
        const marcaAtiva = !filtroEspecialCatalogo && !chipFiltro && chipMarca === termo;
        chip.classList.toggle("active", filtroAtivo || marcaAtiva);
    });
}

// ==========================================
// MODAL WHATSAPP INTERATIVO E CADASTRO DO CLIENTE
// ==========================================
function abrirModalAtendimento(nomePerfume, marcaPerfume = "") {
    perfumeSelecionadoParaWhatsApp = nomePerfume;
    marcaSelecionadaParaWhatsApp = marcaPerfume;
    preencherFormularioCliente("cliente");
    const clienteCadastrado = clienteTemCadastroCompleto();
    const primeiroNome = primeiroNomeCliente(clienteAtual);
    const titulo = document.getElementById("modal-consulta-titulo");
    const texto = document.getElementById("modal-consulta-texto");
    const acao = document.getElementById("modal-consulta-acao");
    const detalhe = document.getElementById("modal-consulta-detalhe");
    const botaoCadastro = document.getElementById("btn-cadastrar-antes") || document.querySelector(".modal-secondary-action");
    const perfumeModal = document.getElementById("modal-perfume-nome");
    if (perfumeModal) perfumeModal.textContent = montarDescricaoPerfumeMensagem();
    if (titulo) titulo.textContent = clienteCadastrado ? `${primeiroNome}, finalizar consulta` : "Finalizar consulta";
    if (texto) {
        texto.textContent = clienteCadastrado
            ? "Seu cadastro já está salvo. Vamos enviar uma mensagem objetiva para a equipe continuar pelo WhatsApp."
            : "Escolha como deseja seguir. A equipe recebe o perfume selecionado e continua o atendimento pelo WhatsApp.";
    }
    if (acao) acao.textContent = clienteCadastrado ? "Consultar como cliente" : "Consultar agora";
    if (detalhe) detalhe.textContent = clienteCadastrado ? "Usar seus dados salvos no atendimento" : "Ir direto para o WhatsApp";
    if (botaoCadastro) {
        botaoCadastro.hidden = clienteCadastrado;
        botaoCadastro.style.display = clienteCadastrado ? "none" : "";
    }
    const modal = document.getElementById("modal-whatsapp");
    if (modal) {
        modal.style.display = "flex";
    }
}

function fecharModal() {
    const modal = document.getElementById("modal-whatsapp");
    if (modal) {
        modal.style.display = "none";
    }
    preencherFormularioCliente("cliente");
}

function abrirWhatsAppConsulta(nomeCliente = "") {
    const nomeFormatado = formatarNomeCliente(nomeCliente);
    const perfumeDescricao = montarDescricaoPerfumeMensagem();
    const saudacao = nomeFormatado
        ? `Olá! Meu nome é ${nomeFormatado}.`
        : "Olá!";
    const mensagemText = `${saudacao} Vim pelo catálogo da Primor e gostaria de consultar a disponibilidade do perfume ${perfumeDescricao}.`;
    const linkWhatsApp = `https://wa.me/${numeroAtendimento}?text=${encodeURIComponent(mensagemText)}`;
    window.open(linkWhatsApp, "_blank");
}

function consultaDiretaWhatsApp() {
    const botao = document.getElementById("btn-consulta-direta");
    if (botao) botao.disabled = true;
    abrirWhatsAppConsulta(clienteTemCadastroCompleto() ? clienteAtual.nome : "");
    if (botao) botao.disabled = false;
    fecharModal();
}

function irParaCadastroCliente() {
    fecharModal();
    mostrarSecao("cliente");
    definirFeedbackCliente("Cadastre seus dados para facilitar descontos, encomendas e próximos atendimentos.", "info");
}

async function confirmarWhatsApp() {
    const cliente = dadosClienteFormulario("cliente");

    if (!cliente.nome || !cliente.telefone) {
        alert("Nome completo e telefone são obrigatórios.");
        return;
    }

    const botao = document.getElementById("btn-confirmar-disponibilidade");
    if (botao) botao.disabled = true;

    salvarClienteLocal(cliente);
    await registrarCliente(clienteAtual, "consulta_disponibilidade", clienteAtual.auth_user_id);
    preencherFormularioCliente("cliente-login", clienteAtual);
    definirStatusCliente(clienteAtual);

    if (botao) botao.disabled = false;
    fecharModal();
    abrirWhatsAppConsulta(cliente.nome);
}

async function salvarClientePainel(event) {
    event.preventDefault();
    const cliente = dadosClienteFormulario("cliente-login");

    if (!cliente.nome || !cliente.email || !cliente.telefone) {
        definirFeedbackCliente("Preencha nome completo, e-mail e telefone para concluir o cadastro.", "erro");
        return;
    }

    salvarClienteLocal(cliente);
    definirFeedbackCliente("Atualizando cadastro...", "info");
    alternarCarregamentoCliente(true, ["cliente-salvar-btn", "cliente-acessar-btn"]);

    const gravado = await registrarCliente(clienteAtual, "area_cliente", clienteAtual.auth_user_id);
    preencherFormularioCliente("cliente", clienteAtual);
    definirStatusCliente(clienteAtual);
    alternarEdicaoCliente(false);
    alternarCarregamentoCliente(false, ["cliente-salvar-btn", "cliente-acessar-btn"]);

    definirFeedbackCliente(
        gravado
            ? "Cadastro atualizado no banco com sucesso."
            : "Cadastro salvo neste dispositivo, mas o banco ainda precisa do SQL/permissões para atualizar.",
        gravado ? "sucesso" : "erro"
    );
}

// ==========================================
// CARREGAMENTO E FILTRAGEM (VITRINE)
// ==========================================
async function carregarProdutos() {
    const container = document.getElementById("product-list");
    if (!container) return; 

    container.innerHTML = "<p style='text-align:center; width:100%; color:#888;'>Carregando catálogo exclusivo...</p>";

    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/perfumes?order=created_at.desc`, {
            method: "GET",
            headers: headers
        });

        if (!response.ok) throw new Error("Erro ao carregar dados do banco.");

        cacheProdutos = await response.json();
        atualizarResumoCatalogo(cacheProdutos);
        renderizarProdutos(cacheProdutos);
    } catch (error) {
        console.error(error);
        container.innerHTML = "<p style='text-align:center; width:100%; color:red;'>Erro ao carregar os perfumes.</p>";
    }
}

function renderizarProdutos(produtos) {
    const container = document.getElementById("product-list");
    const containerDestaques = document.getElementById("highlights-list");
    const secaoDestaques = document.getElementById("secao-destaques");
    const produtosUnicos = agruparProdutosPorPerfume(produtos)
        .filter(produto => filtroEspecialCatalogo === "novidades" ? produtoEhNovidade(produto) : true)
        .sort((a, b) => compararTextoPtBr(obterMarcaProduto(a), obterMarcaProduto(b)) || compararTextoPtBr(a.nome, b.nome));

    if (!container) return;

    container.innerHTML = "";
    if (containerDestaques) containerDestaques.innerHTML = "";

    // Filtra e exibe os produtos da vitrine.
    const destaques = produtosUnicos.filter(produtoEhDestaque);
    
    if (destaques.length > 0 && containerDestaques && secaoDestaques) {
        secaoDestaques.style.display = "block";
        [...destaques]
            .sort((a, b) => compararTextoPtBr(a.nome, b.nome))
            .forEach(produto => {
                containerDestaques.innerHTML += criarCardHTML(produto);
            });
        padronizarImagensCatalogo(containerDestaques);
    } else if (secaoDestaques) {
        secaoDestaques.style.display = "none";
    }

    if (produtosUnicos.length === 0) {
        container.innerHTML = filtroEspecialCatalogo === "novidades"
            ? "<p class='catalog-empty'>Nenhum recém-chegado disponível no momento.</p>"
            : "<p class='catalog-empty'>Nenhum perfume cadastrado ou encontrado.</p>";
        return;
    }

    const gruposPorMarca = produtosUnicos.reduce((grupos, produto) => {
        const marca = obterMarcaProduto(produto);
        if (!grupos.has(marca)) grupos.set(marca, []);
        grupos.get(marca).push(produto);
        return grupos;
    }, new Map());

    [...gruposPorMarca.entries()]
        .sort(([marcaA], [marcaB]) => compararTextoPtBr(marcaA, marcaB))
        .forEach(([marca, itens]) => {
            const produtosComImagem = itens
                .filter(produto => normalizarImagemProduto(produto.imagem))
                .sort((a, b) => compararTextoPtBr(a.nome, b.nome));
            const produtosSemImagem = itens
                .filter(produto => !normalizarImagemProduto(produto.imagem))
                .sort((a, b) => compararTextoPtBr(a.nome, b.nome));
            const produtosOrdenados = [...produtosComImagem, ...produtosSemImagem];
            const total = produtosOrdenados.length;
            const labelTotal = total === 1 ? "1 perfume" : `${total} perfumes`;
            const grupo = document.createElement("section");
            const marcaExpandida = marcaSelecionadaCatalogo && compararTextoPtBr(marca, marcaSelecionadaCatalogo) === 0;
            grupo.className = `catalog-brand-group ${marcaExpandida ? "is-expanded" : ""}`;
            grupo.innerHTML = `
                <div class="catalog-brand-header">
                    <span>${escaparHTML(marca)}</span>
                    <strong>${labelTotal}</strong>
                </div>
                ${produtosComImagem.length ? `
                    <div class="product-grid catalog-brand-grid">
                        ${produtosComImagem.map(produto => criarCardHTML(produto)).join("")}
                    </div>
                ` : ""}
                ${produtosSemImagem.length ? `
                    <div class="catalog-no-image-label">Sem imagem cadastrada</div>
                    <div class="product-grid catalog-brand-grid catalog-brand-grid-sem-imagem">
                        ${produtosSemImagem.map(produto => criarCardHTML(produto)).join("")}
                    </div>
                ` : ""}
            `;
            container.appendChild(grupo);
        });

    padronizarImagensCatalogo(container);
}

function criarCardHTML(produto) {
    const notasDisplay = produto.notas ? `<p class="notas-texto"><strong>Notas:</strong> ${escaparHTML(produto.notas)}</p>` : "";
    const nomeEscapado = escaparAtributoJS(produto.nome);
    const marcaEscapada = escaparAtributoJS(obterMarcaProduto(produto));
    const nomeSeguro = escaparHTML(produto.nome);
    const volumes = obterVolumesGrupo(produto);
    const volumesDisplay = volumes.length ? `<p class="volumes-texto">Volumes: ${volumes.map(volume => `${volume}ml`).join(", ")}</p>` : "";
    const imagemSegura = escaparHTML(normalizarImagemProduto(produto.imagem));
    const imagemDisplay = imagemSegura
        ? `<img src="${imagemSegura}" alt="${nomeSeguro}" loading="lazy" onload="padronizarImagemCatalogo(this)" onerror="tratarErroImagem(this)">`
        : "";
    const esgotado = produtoEsgotado(produto);
    const sobDemanda = produtoSobDemanda(produto);
    const prazoReposicao = obterPrazoReposicao(produto);
    const statusDisplay = esgotado || sobDemanda || prazoReposicao
        ? `<p class="status-texto ${esgotado ? "status-esgotado" : "status-demanda"}">${esgotado ? "Esgotado no momento" : "Sob demanda"}${prazoReposicao ? ` · ${escaparHTML(prazoReposicao)}` : ""}</p>`
        : "";
    const textoBotao = esgotado ? "Consultar reposição" : sobDemanda ? "Consultar encomenda" : "Consultar disponibilidade";
    const selos = [
        produtoEhDestaque(produto) ? `<span class="card-ribbon card-ribbon-destaque">Mais procurado</span>` : "",
        produtoEhNovidade(produto) ? `<span class="card-ribbon card-ribbon-novo">Recém-chegado</span>` : "",
        esgotado ? `<span class="card-ribbon card-ribbon-esgotado">Esgotado</span>` : "",
        !esgotado && sobDemanda ? `<span class="card-ribbon card-ribbon-demanda">Sob demanda</span>` : ""
    ].filter(Boolean).join("");
    const marcaDisplay = `<span class="card-marca-tag">${escaparHTML(obterMarcaProduto(produto))}</span>`;
    
    return `
        <div class="product-card">
            <div class="image-container ${imagemSegura ? "" : "sem-imagem"}">
                ${selos ? `<div class="card-ribbon-stack">${selos}</div>` : ""}
                ${imagemDisplay}
            </div>
            <div class="product-card-body">
                ${marcaDisplay}
                <h3>${nomeSeguro}</h3>
                ${volumesDisplay}
                ${notasDisplay}
                ${statusDisplay}
                <button class="btn" onclick="abrirModalAtendimento('${nomeEscapado}', '${marcaEscapada}')">
                    ${textoBotao}
                </button>
            </div>
        </div>
    `;
}

function filtrarMarca(marca) {
    marcaSelecionadaCatalogo = marca || "";
    filtroEspecialCatalogo = "";
    mostrarSecao('catalogo');
    atualizarMarcaAtiva(marca);
    fecharMenuMobile();
    
    // Se não passar marca ou for vazia, mostra todo o catálogo
    if (!marca || marca.trim() === "") {
        renderizarProdutos(cacheProdutos);
        return;
    }
    
    // Filtra no banco local em memória buscando correspondência exata ou parcial na propriedade marca
    const filtrados = cacheProdutos.filter(p => {
        const marcaProduto = obterMarcaProduto(p).toLowerCase().trim();
        const nomeProduto = p.nome ? p.nome.toLowerCase().trim() : '';
        const termoBusca = marca.toLowerCase().trim();
        return marcaProduto === termoBusca || nomeProduto.includes(termoBusca);
    });
    
    renderizarProdutos(filtrados);
}

function filtrarNovidades() {
    marcaSelecionadaCatalogo = "";
    filtroEspecialCatalogo = "novidades";
    mostrarSecao("catalogo");
    atualizarMarcaAtiva("");
    fecharMenuMobile();
    if (searchInput) searchInput.value = "";
    renderizarProdutos(cacheProdutos);
}

function configurarRolagemHorizontalSegura() {
    const seletores = ".brand-filter-list, .catalog-brand-grid, .admin-side-brand-filter, .admin-side-status-filter";

    document.addEventListener("pointerdown", event => {
        const area = event.target.closest(seletores);
        if (!area) return;

        area.dataset.dragStartX = String(event.clientX);
        area.dataset.dragStartY = String(event.clientY);
        area.dataset.dragging = "false";
        area.classList.add("is-dragging");
    }, true);

    document.addEventListener("pointermove", event => {
        const area = event.target.closest(seletores);
        if (!area || area.dataset.dragStartX === undefined) return;

        const deltaX = Math.abs(event.clientX - Number(area.dataset.dragStartX));
        const deltaY = Math.abs(event.clientY - Number(area.dataset.dragStartY));
        if (deltaX > 8 && deltaX > deltaY) {
            area.dataset.dragging = "true";
        }
    }, true);

    document.addEventListener("pointerup", event => {
        const area = event.target.closest(seletores);
        if (!area) return;

        window.setTimeout(() => {
            area.classList.remove("is-dragging");
            delete area.dataset.dragStartX;
            delete area.dataset.dragStartY;
        }, 0);
    }, true);

    document.addEventListener("click", event => {
        const area = event.target.closest(seletores);
        if (!area || area.dataset.dragging !== "true") return;

        event.preventDefault();
        event.stopImmediatePropagation();
        area.dataset.dragging = "false";
    }, true);
}

// Inicializador dos mais procurados
configurarRolagemHorizontalSegura();
carregarProdutos();
registrarAcessoCatalogo();

// Busca ativa dinâmica
const searchInput = document.getElementById("search");
const navSearch = document.getElementById("nav-search");
const searchToggle = document.getElementById("search-toggle");
const navActions = document.querySelector(".nav-actions");
const navRightGroup = document.querySelector(".nav-right-group");
const navFlex = document.querySelector(".nav-flex");
const accountMenu = document.querySelector(".account-menu");
let timerFecharBusca = null;

if (accountMenu) {
    accountMenu.addEventListener("mouseleave", () => {
        accountMenu.classList.remove("account-menu-closed");
    });
}

function abrirBuscaNav(focar = true) {
    if (!navSearch || !searchInput || !searchToggle) return;
    window.clearTimeout(timerFecharBusca);
    navSearch.classList.add("search-open");
    navActions?.classList.add("search-active");
    navRightGroup?.classList.add("search-active");
    navFlex?.classList.add("search-active");
    searchToggle.setAttribute("aria-expanded", "true");
    searchToggle.setAttribute("aria-label", "Fechar busca");
    if (focar) searchInput.focus();
}

function fecharBuscaNav() {
    if (!navSearch || !searchInput || !searchToggle) return;
    window.clearTimeout(timerFecharBusca);
    navSearch.classList.remove("search-open");
    navActions?.classList.remove("search-active");
    navRightGroup?.classList.remove("search-active");
    navFlex?.classList.remove("search-active");
    searchToggle.setAttribute("aria-expanded", "false");
    searchToggle.setAttribute("aria-label", "Abrir busca");
    searchInput.blur();
}

function agendarFechamentoBusca() {
    if (!navSearch?.classList.contains("search-open")) return;
    window.clearTimeout(timerFecharBusca);
    timerFecharBusca = window.setTimeout(() => {
        if (document.activeElement !== searchInput) fecharBuscaNav();
    }, 5000);
}

if (searchToggle) {
    searchToggle.addEventListener("click", event => {
        event.stopPropagation();
        if (navSearch?.classList.contains("search-open")) {
            fecharBuscaNav();
        } else {
            abrirBuscaNav();
        }
    });
}

if (searchInput) {
    searchInput.addEventListener("focus", () => abrirBuscaNav(false));
    searchInput.addEventListener("input", function() {
        abrirBuscaNav(false);
        const termo = this.value.toLowerCase().trim();
        marcaSelecionadaCatalogo = "";
        filtroEspecialCatalogo = "";
        if (termo) mostrarSecao("catalogo");
        atualizarMarcaAtiva("");
        const filtrados = cacheProdutos.filter(p => {
            const nome = p.nome ? p.nome.toLowerCase() : '';
            const notas = p.notas ? p.notas.toLowerCase() : '';
            const marca = obterMarcaProduto(p).toLowerCase();
            return nome.includes(termo) || notas.includes(termo) || marca.includes(termo);
        });
        renderizarProdutos(filtrados);
    });
}

document.addEventListener("click", event => {
    if (!navSearch?.classList.contains("search-open")) return;
    if (event.target.closest("#nav-search")) return;
    agendarFechamentoBusca();
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") fecharBuscaNav();
    if (event.key === "Escape") fecharModalCliente();
});

// ==========================================
// PAINEL ADMINISTRADOR (LOGIN E CRUD AGRUPADO)
// ==========================================
function verificarAcesso() {
    const logado = localStorage.getItem("admin_logado") === "true";
    const painel = document.getElementById("painel-admin");
    const loginSec = document.getElementById("login-admin");

    if (painel && loginSec) {
        if (!logado) {
            painel.style.display = "none";
            loginSec.style.display = "block";
        } else {
            painel.style.display = "block";
            loginSec.style.display = "none";
            verificarSuporteCampoNovidade();
            verificarSuporteCamposDisponibilidade();
            carregarProdutosAdmin();
            carregarResumoAcessosAdmin();
            carregarMarcas();
        }
    }
}

if (document.getElementById("login-admin") || document.getElementById("painel-admin")) {
    verificarAcesso();
}

async function login() {
    const senhaDigitada = document.getElementById("senha").value;

    if (!senhaDigitada) {
        alert("Por favor, digite a senha.");
        return;
    }

    try {
        const rpcResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/validar_admin_primor`, {
            method: "POST",
            headers,
            body: JSON.stringify({ p_senha: senhaDigitada })
        });

        if (!rpcResponse.ok) {
            throw new Error("Funcao validar_admin_primor indisponivel. Rode supabase/sql/primor_rls_producao.sql no Supabase.");
        }

        const autorizado = await rpcResponse.json();
        if (autorizado === true) {
            localStorage.setItem("admin_logado", "true");
            sessionStorage.setItem("admin_senha", senhaDigitada);
            verificarAcesso();
            return;
        }

        alert("Senha incorreta!");
        document.getElementById("senha").value = "";
    } catch (e) {
        console.error(e);
        alert("Erro ao validar senha.");
    }
}

function logout() {
    localStorage.removeItem("admin_logado");
    sessionStorage.removeItem("admin_senha");
    window.location.reload();
}

function trocarCategoriaAdmin(categoria) {
    const categoriaAtiva = categoria || "visao-geral";

    document.querySelectorAll(".admin-panel").forEach(painel => {
        painel.classList.toggle("active", painel.id === `admin-panel-${categoriaAtiva}`);
    });

    document.querySelectorAll("[data-admin-tab]").forEach(botao => {
        botao.classList.toggle("active", botao.dataset.adminTab === categoriaAtiva);
    });
}

function obterVolumesFormulario() {
    const valor = document.getElementById("volumes")?.value || "";
    const volumes = valor
        .split(/[,;\s]+/)
        .map(item => Number(String(item).replace(/\D/g, "")))
        .filter(volume => Number.isFinite(volume) && volume > 0)
        .sort((a, b) => a - b);

    return [...new Set(volumes)];
}

function preencherVolumesRapidos(volumes) {
    const input = document.getElementById("volumes");
    if (!input) return;
    const atuais = obterVolumesFormulario();
    const novos = [...new Set([...atuais, ...volumes])].sort((a, b) => a - b);
    input.value = novos.join(", ");
}

async function verificarSuporteCampoNovidade() {
    const checkbox = document.getElementById("novidade");
    const inputPrazo = document.getElementById("novidade-ate");
    const ajuda = document.getElementById("novidade-help");
    if (!checkbox) return;

    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/perfumes?select=novidade,novidade_ate&limit=1`, {
            method: "GET",
            headers
        });

        suporteCampoNovidade = response.ok;
    } catch (error) {
        suporteCampoNovidade = false;
    }

    checkbox.disabled = !suporteCampoNovidade;
    if (inputPrazo) inputPrazo.disabled = !suporteCampoNovidade;
    if (ajuda) ajuda.style.display = suporteCampoNovidade ? "none" : "block";
}

async function verificarSuporteCamposDisponibilidade() {
    const controles = [
        document.getElementById("esgotado"),
        document.getElementById("sob-demanda"),
        document.getElementById("prazo-reposicao")
    ].filter(Boolean);
    const ajuda = document.getElementById("disponibilidade-help");
    if (!controles.length) return;

    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/perfumes?select=esgotado,sob_demanda,prazo_reposicao&limit=1`, {
            method: "GET",
            headers
        });

        suporteCamposDisponibilidade = response.ok;
    } catch (error) {
        suporteCamposDisponibilidade = false;
    }

    controles.forEach(controle => {
        controle.disabled = !suporteCamposDisponibilidade;
    });
    if (ajuda) ajuda.style.display = suporteCamposDisponibilidade ? "none" : "block";
}

function montarNomeProduto(nomeBase, volume) {
    const base = obterNomeBaseProduto({ nome: nomeBase }) || nomeBase;
    return volume ? `${base} ${volume}ml` : base;
}

function gerarChaveAdmin(nomeBase, marca) {
    const nome = String(nomeBase ?? "").toLowerCase().trim().replace(/\s+/g, " ");
    const marcaNormalizada = String(marca ?? "").toLowerCase().trim().replace(/\s+/g, " ");
    return `${nome}::${marcaNormalizada}`;
}

function agruparProdutosAdmin(produtos) {
    const grupos = new Map();

    produtos.forEach(produto => {
        const nomeBase = obterNomeBaseProduto(produto) || produto.nome || "Sem nome";
        const marca = obterMarcaProduto(produto);
        const chave = gerarChaveAdmin(nomeBase, marca);
        const volume = obterVolumeProduto(produto);

        if (!grupos.has(chave)) {
            grupos.set(chave, {
                chave,
                nome: nomeBase,
                marca,
                imagem: normalizarImagemProduto(produto.imagem),
                notas: produto.notas || "",
                destaque: produtoEhDestaque(produto),
                novidade: produtoEhNovidade(produto),
                novidade_ate: obterNovidadeAte(produto),
                esgotado: produtoEsgotado(produto),
                sob_demanda: produtoSobDemanda(produto),
                prazo_reposicao: obterPrazoReposicao(produto),
                variacoes: [],
                volumes: []
            });
        }

        const grupo = grupos.get(chave);
        grupo.variacoes.push(produto);
        if (volume) grupo.volumes.push(volume);
        if (!grupo.imagem && normalizarImagemProduto(produto.imagem)) grupo.imagem = produto.imagem;
        if (!grupo.notas && produto.notas) grupo.notas = produto.notas;
        if (produtoEhDestaque(produto)) grupo.destaque = true;
        if (produtoEhNovidade(produto)) {
            grupo.novidade = true;
            const novidadeAte = obterNovidadeAte(produto);
            if (novidadeAte && (!grupo.novidade_ate || novidadeAte > grupo.novidade_ate)) grupo.novidade_ate = novidadeAte;
        }
        if (produtoEsgotado(produto)) grupo.esgotado = true;
        if (produtoSobDemanda(produto)) grupo.sob_demanda = true;
        if (!grupo.prazo_reposicao && obterPrazoReposicao(produto)) grupo.prazo_reposicao = produto.prazo_reposicao;
    });

    grupos.forEach(grupo => {
        grupo.volumes = [...new Set(grupo.volumes.map(Number).filter(Boolean))].sort((a, b) => a - b);
        grupo.variacoes.sort((a, b) => (obterVolumeProduto(a) || 0) - (obterVolumeProduto(b) || 0));
    });

    return grupos;
}

function atualizarPreviewImagemAdmin() {
    const preview = document.getElementById("imagem-preview");
    const input = document.getElementById("imagem");
    if (!preview || !input) return;

    const url = normalizarImagemProduto(input.value);
    preview.innerHTML = url
        ? `<img src="${escaparHTML(url)}" alt="Prévia da imagem" onerror="this.parentElement.classList.add('sem-imagem'); this.remove();">`
        : `<span>Prévia da imagem</span>`;
    preview.classList.toggle("sem-imagem", !url);
}

function sincronizarListaImagensAdmin(produtos) {
    const datalist = document.getElementById("imagens-cadastradas");
    if (!datalist) return;

    const urls = [...new Set(produtos.map(p => normalizarImagemProduto(p.imagem)).filter(Boolean))];
    datalist.innerHTML = urls.map(url => `<option value="${escaparHTML(url)}"></option>`).join("");
}

function sugerirImagemPorGrupo() {
    const nomeBase = document.getElementById("nome")?.value || "";
    const marca = document.getElementById("marca")?.value || "";
    const imagem = document.getElementById("imagem");
    if (!imagem || imagem.value.trim()) return;

    const chave = gerarChaveAdmin(obterNomeBaseProduto({ nome: nomeBase }) || nomeBase, marca);
    const grupo = cacheGruposAdmin.get(chave);
    if (grupo?.imagem) {
        imagem.value = grupo.imagem;
        atualizarPreviewImagemAdmin();
    }
}

function produtoAtualPorVolume(grupo, volume) {
    return grupo?.variacoes?.find(produto => obterVolumeProduto(produto) === volume) || null;
}

async function chamarRpcAdmin(nomeFuncao, payload = {}) {
    const senhaAdmin = sessionStorage.getItem("admin_senha");

    if (!senhaAdmin) {
        alert("Entre novamente no painel antes de alterar o catálogo.");
        logout();
        throw new Error("Senha admin ausente na sessão.");
    }

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nomeFuncao}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            p_senha: senhaAdmin,
            ...payload
        })
    });

    if (!response.ok) {
        const erro = await response.text();
        throw new Error(erro || `Falha ao executar ${nomeFuncao}.`);
    }

    if (response.status === 204) return null;
    const texto = await response.text();
    return texto ? JSON.parse(texto) : null;
}

function montarPayloadPerfumeAdmin(produto, id = null) {
    const payload = {
        p_id: id,
        p_nome: produto.nome,
        p_marca: produto.marca,
        p_imagem: produto.imagem || "",
        p_notas: produto.notas || "",
        p_destaque: produtoEhDestaque(produto)
    };

    if (suporteCampoNovidade) {
        payload.p_novidade = produtoEhNovidade(produto);
        payload.p_novidade_ate = obterNovidadeAte(produto) || null;
    }

    if (suporteCamposDisponibilidade) {
        payload.p_esgotado = produtoEsgotado(produto);
        payload.p_sob_demanda = produtoSobDemanda(produto);
        payload.p_prazo_reposicao = obterPrazoReposicao(produto);
    }

    return payload;
}

async function salvarProduto() {
    const nomeBaseOriginal = document.getElementById("nome").value.trim();
    const nomeBase = obterNomeBaseProduto({ nome: nomeBaseOriginal }) || nomeBaseOriginal;
    const marca = document.getElementById("marca").value.trim();
    const imagem = normalizarImagemProduto(document.getElementById("imagem").value);
    const notas = document.getElementById("notas").value.trim();
    const destaque = document.getElementById("destaque").checked;
    const novidade = document.getElementById("novidade")?.checked === true;
    const novidadeAte = novidade
        ? (document.getElementById("novidade-ate")?.value || adicionarDiasISO(15))
        : "";
    const esgotado = document.getElementById("esgotado")?.checked === true;
    const sobDemanda = document.getElementById("sob-demanda")?.checked === true;
    const prazoReposicao = document.getElementById("prazo-reposicao")?.value.trim() || "";
    const volumes = obterVolumesFormulario();
    const chaveEdicao = document.getElementById("edit-chave")?.value || "";
    const grupoAtual = chaveEdicao ? cacheGruposAdmin.get(chaveEdicao) : null;

    if (!nomeBase) {
        alert("Nome base do perfume é obrigatório.");
        return;
    }

    if (!marca) {
        alert("Selecione ou cadastre uma marca antes de salvar.");
        return;
    }

    if (volumes.length === 0) {
        alert("Informe pelo menos um volume. Exemplo: 30, 50, 100.");
        return;
    }

    const registros = volumes.map(volume => ({
        nome: montarNomeProduto(nomeBase, volume),
        marca,
        imagem,
        notas,
        destaque,
        ...(suporteCampoNovidade ? { novidade, novidade_ate: novidadeAte } : {}),
        ...(suporteCamposDisponibilidade ? {
            esgotado,
            sob_demanda: sobDemanda,
            prazo_reposicao: prazoReposicao
        } : {})
    }));

    try {
        for (const registro of registros) {
            const volume = obterVolumeProduto(registro);
            const existente = produtoAtualPorVolume(grupoAtual, volume);
            await chamarRpcAdmin("admin_upsert_perfume", montarPayloadPerfumeAdmin(registro, existente?.id || null));
        }

        if (grupoAtual) {
            const volumesMantidos = new Set(volumes);
            const removidos = grupoAtual.variacoes.filter(produto => {
                const volume = obterVolumeProduto(produto);
                return volume && !volumesMantidos.has(volume);
            });

            for (const produto of removidos) {
                await chamarRpcAdmin("admin_delete_perfume", { p_id: produto.id });
            }
        }

        alert(grupoAtual ? "Perfume e variações atualizados!" : "Perfume cadastrado com as variações informadas!");
        cancelarEdicao();
        carregarProdutosAdmin();
        carregarProdutos();
    } catch (err) {
        console.error(err);
        alert("Erro de salvamento no banco. Confira o console para detalhes.");
    }
}

function prepararEdicaoGrupo(chave) {
    const grupo = cacheGruposAdmin.get(chave);
    if (!grupo) return;

    trocarCategoriaAdmin("perfumes");
    document.getElementById("edit-id").value = grupo.variacoes.map(p => p.id).join(",");
    document.getElementById("edit-chave").value = grupo.chave;
    document.getElementById("nome").value = grupo.nome;
    document.getElementById("marca").value = grupo.marca;
    document.getElementById("imagem").value = grupo.imagem || "";
    document.getElementById("notas").value = grupo.notas || "";
    document.getElementById("volumes").value = grupo.volumes.join(", ");
    document.getElementById("destaque").checked = grupo.destaque === true;
    const novidade = document.getElementById("novidade");
    if (novidade) novidade.checked = grupo.novidade === true;
    const novidadeAte = document.getElementById("novidade-ate");
    if (novidadeAte) novidadeAte.value = grupo.novidade_ate || (grupo.novidade ? adicionarDiasISO(15) : "");
    const esgotado = document.getElementById("esgotado");
    if (esgotado) esgotado.checked = grupo.esgotado === true;
    const sobDemanda = document.getElementById("sob-demanda");
    if (sobDemanda) sobDemanda.checked = grupo.sob_demanda === true;
    const prazoReposicao = document.getElementById("prazo-reposicao");
    if (prazoReposicao) prazoReposicao.value = grupo.prazo_reposicao || "";

    document.getElementById("titulo-form").innerText = "Editar Perfume Agrupado";
    document.getElementById("btn-salvar").innerText = "Salvar Perfume e Variações";
    document.getElementById("btn-cancelar").style.display = "block";
    atualizarPreviewImagemAdmin();

    window.scrollTo({ top: 0, behavior: "smooth" });
}

function prepararEdicao(id, nome, marca, imagem, notas, destaque) {
    const nomeBase = obterNomeBaseProduto({ nome }) || nome;
    const chave = gerarChaveAdmin(nomeBase, marca);
    prepararEdicaoGrupo(chave);
}

function duplicarGrupo(chave) {
    const grupo = cacheGruposAdmin.get(chave);
    if (!grupo) return;

    trocarCategoriaAdmin("perfumes");
    document.getElementById("edit-id").value = "";
    document.getElementById("edit-chave").value = "";
    document.getElementById("nome").value = grupo.nome;
    document.getElementById("marca").value = grupo.marca;
    document.getElementById("imagem").value = grupo.imagem || "";
    document.getElementById("notas").value = grupo.notas || "";
    document.getElementById("volumes").value = "";
    document.getElementById("destaque").checked = grupo.destaque === true;
    const novidade = document.getElementById("novidade");
    if (novidade) novidade.checked = grupo.novidade === true;
    const novidadeAte = document.getElementById("novidade-ate");
    if (novidadeAte) novidadeAte.value = grupo.novidade_ate || (grupo.novidade ? adicionarDiasISO(15) : "");
    const esgotado = document.getElementById("esgotado");
    if (esgotado) esgotado.checked = grupo.esgotado === true;
    const sobDemanda = document.getElementById("sob-demanda");
    if (sobDemanda) sobDemanda.checked = grupo.sob_demanda === true;
    const prazoReposicao = document.getElementById("prazo-reposicao");
    if (prazoReposicao) prazoReposicao.value = grupo.prazo_reposicao || "";
    document.getElementById("titulo-form").innerText = "Cadastrar Novo Perfume";
    document.getElementById("btn-salvar").innerText = "Adicionar ao Banco de Dados";
    document.getElementById("btn-cancelar").style.display = "block";
    atualizarPreviewImagemAdmin();

    window.scrollTo({ top: 0, behavior: "smooth" });
}

function cancelarEdicao() {
    const campos = ["edit-id", "edit-chave", "nome", "imagem", "notas", "volumes"];
    campos.forEach(id => {
        const campo = document.getElementById(id);
        if (campo) campo.value = "";
    });

    const destaque = document.getElementById("destaque");
    if (destaque) destaque.checked = false;
    const novidade = document.getElementById("novidade");
    if (novidade) novidade.checked = false;
    const novidadeAte = document.getElementById("novidade-ate");
    if (novidadeAte) novidadeAte.value = "";
    const esgotado = document.getElementById("esgotado");
    if (esgotado) esgotado.checked = false;
    const sobDemanda = document.getElementById("sob-demanda");
    if (sobDemanda) sobDemanda.checked = false;
    const prazoReposicao = document.getElementById("prazo-reposicao");
    if (prazoReposicao) prazoReposicao.value = "";

    document.getElementById("titulo-form").innerText = "Cadastrar Novo Perfume";
    document.getElementById("btn-salvar").innerText = "Adicionar ao Banco de Dados";
    document.getElementById("btn-cancelar").style.display = "none";
    atualizarPreviewImagemAdmin();
}

async function deletarProduto(id) {
    if (!confirm("Tem certeza que deseja remover este perfume?")) return;

    try {
        await chamarRpcAdmin("admin_delete_perfume", { p_id: id });
        carregarProdutosAdmin();
        carregarProdutos();
    } catch (e) {
        alert("Erro ao excluir.");
    }
}

async function deletarGrupo(chave) {
    const grupo = cacheGruposAdmin.get(chave);
    if (!grupo) return;

    if (!confirm(`Remover ${grupo.nome} e todas as variações cadastradas (${grupo.volumes.join(", ")}ml)?`)) return;

    try {
        for (const produto of grupo.variacoes) {
            await chamarRpcAdmin("admin_delete_perfume", { p_id: produto.id });
        }
        carregarProdutosAdmin();
        carregarProdutos();
    } catch (e) {
        console.error(e);
        alert("Erro ao excluir o grupo de perfumes.");
    }
}

function renderizarResumoAdmin(produtos, grupos) {
    const resumo = document.getElementById("admin-resumo");
    if (!resumo) return;

    const marcas = new Set(produtos.map(p => obterMarcaProduto(p)).filter(Boolean));
    const gruposLista = [...grupos.values()];
    const vitrine = gruposLista.filter(grupo => grupo.destaque).length;
    const novidades = gruposLista.filter(grupo => grupo.novidade).length;
    const atencoes = gruposLista.filter(grupo => grupo.esgotado || !normalizarImagemProduto(grupo.imagem)).length;
    const semImagem = gruposLista.filter(grupo => !normalizarImagemProduto(grupo.imagem)).length;
    const esgotados = gruposLista.filter(grupo => grupo.esgotado).length;
    const sobDemanda = gruposLista.filter(grupo => grupo.sob_demanda).length;
    const semNotas = gruposLista.filter(grupo => !String(grupo.notas || "").trim()).length;
    const totalVolumes = gruposLista.reduce((total, grupo) => total + grupo.volumes.length, 0);

    resumo.innerHTML = `
        <div><strong>${grupos.size}</strong><span>Perfumes agrupados</span></div>
        <div><strong>${produtos.length}</strong><span>Variações cadastradas</span></div>
        <div><strong>${marcas.size}</strong><span>Marcas</span></div>
        <div><strong>${vitrine}</strong><span>Mais procurados</span></div>
        <div><strong>${novidades}</strong><span>Recém chegados</span></div>
        <div><strong>${atencoes}</strong><span>Atenções</span></div>
    `;

    const insights = document.getElementById("admin-insights");
    if (!insights) return;

    insights.innerHTML = `
        <div>
            <span>Organizacao</span>
            <strong>${totalVolumes}</strong>
            <small>Volumes cadastrados em perfumes agrupados.</small>
        </div>
        <div>
            <span>Imagens</span>
            <strong>${semImagem}</strong>
            <small>Perfumes sem imagem para revisar depois.</small>
        </div>
        <div>
            <span>Notas olfativas</span>
            <strong>${semNotas}</strong>
            <small>Cadastros sem notas preenchidas.</small>
        </div>
        <div>
            <span>Disponibilidade</span>
            <strong>${esgotados + sobDemanda}</strong>
            <small>${esgotados} esgotado(s) e ${sobDemanda} sob demanda.</small>
        </div>
    `;
}

function renderizarCatalogoLateralAdmin() {
    const container = document.getElementById("lista-admin-lateral");
    if (!container || !cacheGruposAdmin?.size) return;

    const termo = (document.getElementById("busca-admin-lateral")?.value || "").toLowerCase().trim();
    const marcaFiltro = marcaLateralAdmin.toLowerCase().trim();
    const grupos = [...cacheGruposAdmin.values()]
        .filter(grupo => {
            const texto = `${grupo.nome} ${grupo.marca} ${grupo.notas}`.toLowerCase();
            const passaBusca = !termo || texto.includes(termo);
            const passaMarca = !marcaFiltro || grupo.marca.toLowerCase() === marcaFiltro;
            const passaStatus = grupoPassaStatusAdmin(grupo, statusLateralAdmin);
            return passaBusca && passaMarca && passaStatus;
        })
        .sort((a, b) => a.marca.localeCompare(b.marca) || a.nome.localeCompare(b.nome));

    if (!grupos.length) {
        container.innerHTML = "<p>Nenhum perfume encontrado.</p>";
        return;
    }

    const marcas = new Map();
    grupos.forEach(grupo => {
        if (!marcas.has(grupo.marca)) marcas.set(grupo.marca, []);
        marcas.get(grupo.marca).push(grupo);
    });

    container.innerHTML = [...marcas.entries()].map(([marca, itens]) => `
        <section class="admin-side-brand">
            <h4>${escaparHTML(marca)} <span>${itens.length}</span></h4>
            ${itens.map(grupo => {
                const chave = escaparAtributoJS(grupo.chave);
                const imagem = normalizarImagemProduto(grupo.imagem);
                const volumes = grupo.volumes.length ? grupo.volumes.map(v => `${v}ml`).join(", ") : "Sem volume";
                const status = [
                    grupo.destaque ? "Mais procurado" : "",
                    grupo.novidade ? "Novo" : "",
                    grupo.esgotado ? "Esgotado" : "",
                    grupo.sob_demanda ? "Encomenda" : "",
                    !imagem ? "Sem imagem" : ""
                ].filter(Boolean).join(" · ");

                return `
                    <button type="button" class="admin-side-product" onclick="prepararEdicaoGrupo('${chave}')">
                        <span class="admin-side-thumb">${imagem ? `<img src="${escaparHTML(imagem)}" alt="${escaparHTML(grupo.nome)}">` : "Sem imagem"}</span>
                        <span class="admin-side-info">
                            <strong>${escaparHTML(grupo.nome)}</strong>
                            <small>${escaparHTML(volumes)}</small>
                            ${status ? `<em>${escaparHTML(status)}</em>` : ""}
                        </span>
                    </button>
                `;
            }).join("")}
        </section>
    `).join("");
}

function filtrarMarcaLateralAdmin(marca) {
    marcaLateralAdmin = String(marca || "").trim();

    document.querySelectorAll("#filtro-marcas-lateral button").forEach(botao => {
        botao.classList.toggle("active", (botao.dataset.marca || "") === marcaLateralAdmin);
    });

    renderizarCatalogoLateralAdmin();
}

function filtrarStatusLateralAdmin(status) {
    statusLateralAdmin = String(status || "").trim();

    document.querySelectorAll("#filtro-status-lateral button").forEach(botao => {
        botao.classList.toggle("active", (botao.dataset.status || "") === statusLateralAdmin);
    });

    renderizarCatalogoLateralAdmin();
}

function grupoPassaStatusAdmin(grupo, statusFiltro) {
    if (!statusFiltro) return true;

    const temImagem = Boolean(normalizarImagemProduto(grupo.imagem));
    const temNotas = Boolean(String(grupo.notas || "").trim());

    return (statusFiltro === "disponivel" && !grupo.esgotado && !grupo.sob_demanda)
        || (statusFiltro === "vitrine" && grupo.destaque)
        || (statusFiltro === "novidade" && grupo.novidade)
        || (statusFiltro === "esgotado" && grupo.esgotado)
        || (statusFiltro === "demanda" && grupo.sob_demanda)
        || (statusFiltro === "sem-imagem" && !temImagem)
        || (statusFiltro === "sem-notas" && !temNotas);
}

function renderizarProdutosAdmin(produtos) {
    const container = document.getElementById("lista-admin");
    if (!container) return;

    cacheGruposAdmin = agruparProdutosAdmin(produtos);
    renderizarResumoAdmin(produtos, cacheGruposAdmin);
    renderizarCatalogoLateralAdmin();
    sincronizarListaImagensAdmin(produtos);

    const termo = (document.getElementById("busca-admin")?.value || "").toLowerCase().trim();
    const marcaFiltro = (document.getElementById("filtro-marca-admin")?.value || "").toLowerCase().trim();
    const statusFiltro = (document.getElementById("filtro-status-admin")?.value || "").trim();
    const grupos = [...cacheGruposAdmin.values()].filter(grupo => {
        const texto = `${grupo.nome} ${grupo.marca} ${grupo.notas}`.toLowerCase();
        const passaBusca = !termo || texto.includes(termo);
        const passaMarca = !marcaFiltro || grupo.marca.toLowerCase() === marcaFiltro;
        const passaStatus = grupoPassaStatusAdmin(grupo, statusFiltro);
        return passaBusca && passaMarca && passaStatus;
    }).sort((a, b) => a.marca.localeCompare(b.marca) || a.nome.localeCompare(b.nome));

    if (grupos.length === 0) {
        container.innerHTML = "<p>Nenhum perfume encontrado para os filtros atuais.</p>";
        return;
    }

    const marcas = new Map();
    grupos.forEach(grupo => {
        if (!marcas.has(grupo.marca)) marcas.set(grupo.marca, []);
        marcas.get(grupo.marca).push(grupo);
    });

    container.innerHTML = [...marcas.entries()].map(([marca, itens]) => `
        <section class="admin-brand-section">
            <h4>${escaparHTML(marca)}</h4>
            ${itens.map(grupo => {
                const chave = escaparAtributoJS(grupo.chave);
                const volumes = grupo.volumes.length ? grupo.volumes.map(v => `${v}ml`).join(", ") : "Sem volume";
                const imagem = normalizarImagemProduto(grupo.imagem);
                const selosAdmin = [
                    grupo.destaque ? `<span>Procurado</span>` : "",
                    grupo.novidade ? `<span>Recém-chegado${grupo.novidade_ate ? ` até ${escaparHTML(grupo.novidade_ate)}` : ""}</span>` : "",
                    grupo.esgotado ? `<span>Esgotado</span>` : "",
                    grupo.sob_demanda ? `<span>Sob demanda</span>` : "",
                    grupo.prazo_reposicao ? `<span>${escaparHTML(grupo.prazo_reposicao)}</span>` : ""
                ].filter(Boolean).join("");
                return `
                    <div class="admin-product-row">
                        <div class="admin-thumb ${imagem ? "" : "sem-imagem"}">${imagem ? `<img src="${escaparHTML(imagem)}" alt="${escaparHTML(grupo.nome)}">` : "Sem imagem"}</div>
                        <div class="admin-product-info">
                            <strong>${escaparHTML(grupo.nome)}</strong>
                            ${selosAdmin ? `<div class="admin-product-badges">${selosAdmin}</div>` : ""}
                            <small>${escaparHTML(volumes)} • ${grupo.variacoes.length} variação(ões)</small>
                            ${grupo.notas ? `<small>Notas: ${escaparHTML(grupo.notas)}</small>` : ""}
                        </div>
                        <div class="admin-actions-flex">
                            <button class="btn-editar" onclick="prepararEdicaoGrupo('${chave}')">Editar</button>
                            <button class="btn-editar btn-duplicar" onclick="duplicarGrupo('${chave}')">Duplicar</button>
                            <button class="btn-deletar" onclick="deletarGrupo('${chave}')">Excluir</button>
                        </div>
                    </div>
                `;
            }).join("")}
        </section>
    `).join("");
}

async function carregarProdutosAdmin() {
    const container = document.getElementById("lista-admin");
    if (!container) return;

    container.innerHTML = "<p>Carregando catálogo cadastrado...</p>";

    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/perfumes?order=marca.asc,nome.asc`, {
            method: "GET",
            headers: headers
        });

        if (!response.ok) throw new Error("Erro ao carregar perfumes no admin.");

        cacheProdutosAdmin = await response.json();
        renderizarProdutosAdmin(cacheProdutosAdmin);
    } catch (error) {
        console.error(error);
        container.innerHTML = "<p>Erro ao listar os perfumes no gerenciador.</p>";
    }
}

function filtrarAdmin() {
    renderizarProdutosAdmin(cacheProdutosAdmin);
}

// ==========================================
// GERENCIAMENTO DINÂMICO DE MARCAS
// ==========================================
function baixarArquivo(nomeArquivo, conteudo, tipo) {
    const blob = new Blob([conteudo], { type: tipo });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = nomeArquivo;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function valorCSV(valor) {
    return `"${String(valor ?? "").replace(/"/g, '""')}"`;
}

function escaparHTMLPlanilha(valor) {
    return String(valor ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function valorBooleanoExportacao(valor) {
    return valor === true || valor === "true" ? "Sim" : "Não";
}

function valorTextoExcel(valor) {
    const texto = String(valor ?? "").trim();
    return texto ? `="${texto.replace(/"/g, '""')}"` : "";
}

function formatarDataBR(valor) {
    if (!valor) return "";
    const partes = String(valor).slice(0, 10).split("-");
    if (partes.length !== 3) return String(valor);
    const [ano, mes, dia] = partes;
    return `${dia}/${mes}/${ano}`;
}

function formatarDataHoraBR(valor) {
    if (!valor) return "";
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return String(valor);

    return new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }).format(data);
}

function formatarOrigemCliente(valor) {
    const origens = {
        area_cliente: "Área do cliente",
        consulta_disponibilidade: "Consulta disponibilidade",
        consulta_whatsapp: "Consulta WhatsApp",
        login_auth: "Confirmação de acesso",
        confirmacao_email: "Confirmação de e-mail"
    };

    return origens[valor] || valor || "";
}

function valorClienteExportacao(cliente, coluna) {
    const valor = cliente[coluna.campo];

    if (coluna.tipo === "nome") return formatarNomeCliente(valor);
    if (coluna.tipo === "texto") return String(valor ?? "").trim();
    if (coluna.tipo === "data") return formatarDataBR(valor);
    if (coluna.tipo === "datahora") return formatarDataHoraBR(valor);
    if (coluna.tipo === "origem") return formatarOrigemCliente(valor);

    return valor ?? "";
}

function valorPerfumeExportacao(produto, coluna) {
    const valor = produto[coluna.campo];

    if (coluna.tipo === "texto") return String(valor ?? "").trim();
    if (coluna.tipo === "booleano") return valorBooleanoExportacao(valor);
    if (coluna.tipo === "data") return formatarDataBR(valor);
    if (coluna.tipo === "datahora") return formatarDataHoraBR(valor);

    return valor ?? "";
}

function montarPlanilhaHTML({ titulo, subtitulo, colunas, linhas }) {
    const data = formatarDataHoraBR(new Date().toISOString());
    const cabecalho = colunas.map(coluna => `<th>${escaparHTMLPlanilha(coluna.titulo)}</th>`).join("");
    const corpo = linhas.map(linha => `
        <tr>
            ${colunas.map(coluna => {
                const valor = linha[coluna.campo];
                const classeStatus = coluna.classe === "status"
                    ? (valor === "Sim" ? " status-sim" : " status-nao")
                    : "";
                const classe = coluna.classe || classeStatus
                    ? ` class="${[coluna.classe, classeStatus.trim()].filter(Boolean).join(" ")}"`
                    : "";
                return `<td${classe}>${escaparHTMLPlanilha(valor)}</td>`;
            }).join("")}
        </tr>
    `).join("");

    return `<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: Aptos, Calibri, Arial, sans-serif; color: #1f1f1f; }
        .title { background: #111111; color: #f7d887; font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 800; }
        .subtitle { background: #241c12; color: #f4ead6; font-size: 14px; }
        table { border-collapse: collapse; width: 100%; }
        th { background: #c5a059; color: #111111; font-size: 14px; font-weight: 800; text-align: left; border: 1px solid #9f7b31; padding: 10px; }
        td { border: 1px solid #ddd2bd; padding: 9px; font-size: 13px; vertical-align: top; mso-number-format:"\\@"; }
        tr:nth-child(even) td { background: #fff8ec; }
        .id { text-align: center; background: #f4ead6; font-weight: 700; }
        .status-sim { color: #1f6f3d; font-weight: 700; }
        .status-nao { color: #8a8a8a; }
        .link, .long-text { width: 380px; white-space: normal; }
        .date { width: 130px; }
        .phone { width: 150px; }
    </style>
</head>
<body>
    <table>
        <tr><td class="title" colspan="${colunas.length}">${escaparHTMLPlanilha(titulo)}</td></tr>
        <tr><td class="subtitle" colspan="${colunas.length}">${escaparHTMLPlanilha(subtitulo)} | Gerado em ${escaparHTMLPlanilha(data)}</td></tr>
        <tr>${cabecalho}</tr>
        ${corpo}
    </table>
</body>
</html>`;
}

function montarRelatorioGerencialHTML({ secoes }) {
    const data = formatarDataHoraBR(new Date().toISOString());
    const tabelas = secoes.map(secao => {
        const cabecalho = secao.colunas.map(coluna => `<th>${escaparHTMLPlanilha(coluna.titulo)}</th>`).join("");
        const linhas = secao.linhas.map(linha => `
            <tr>
                ${secao.colunas.map(coluna => `<td>${escaparHTMLPlanilha(linha[coluna.campo])}</td>`).join("")}
            </tr>
        `).join("");

        return `
            <tr><td class="section" colspan="${secao.colunas.length}">${escaparHTMLPlanilha(secao.titulo)}</td></tr>
            <tr>${cabecalho}</tr>
            ${linhas || `<tr><td colspan="${secao.colunas.length}">Sem dados para esta seção.</td></tr>`}
            <tr><td class="gap" colspan="${secao.colunas.length}"></td></tr>
        `;
    }).join("");

    return `<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: Aptos, Calibri, Arial, sans-serif; color: #1f1f1f; }
        table { border-collapse: collapse; width: 100%; }
        .title { background: #111111; color: #f7d887; font-family: Georgia, 'Times New Roman', serif; font-size: 28px; font-weight: 800; }
        .subtitle { background: #241c12; color: #f4ead6; font-size: 14px; }
        .section { background: #f4ead6; color: #6f5527; font-size: 18px; font-weight: 800; border: 1px solid #d8c49a; padding: 10px; }
        th { background: #c5a059; color: #111111; font-size: 14px; font-weight: 800; text-align: left; border: 1px solid #9f7b31; padding: 10px; }
        td { border: 1px solid #ddd2bd; padding: 9px; font-size: 13px; vertical-align: top; mso-number-format:"\\@"; }
        tr:nth-child(even) td { background: #fffaf2; }
        .gap { height: 18px; background: #ffffff; border: 0; }
    </style>
</head>
<body>
    <table>
        <tr><td class="title" colspan="4">Primor Poços - Relatório Gerencial</td></tr>
        <tr><td class="subtitle" colspan="4">Resumo estratégico do catálogo | Gerado em ${escaparHTMLPlanilha(data)}</td></tr>
        ${tabelas}
    </table>
</body>
</html>`;
}

async function exportarBanco(formato) {
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/perfumes?order=created_at.asc`, {
            method: "GET",
            headers: headers
        });

        if (!response.ok) throw new Error("Falha ao exportar catálogo.");

        const produtos = await response.json();
        const data = new Date().toISOString().slice(0, 10);

        if (formato === "xls") {
            const colunas = [
                { campo: "id", titulo: "ID", classe: "id" },
                { campo: "nome", titulo: "Perfume" },
                { campo: "marca", titulo: "Marca" },
                { campo: "notas", titulo: "Notas olfativas", classe: "long-text" },
                { campo: "imagem", titulo: "Imagem", tipo: "texto", classe: "link" },
                { campo: "destaque", titulo: "Mais procurado", tipo: "booleano", classe: "status" },
                { campo: "novidade", titulo: "Recém-chegado", tipo: "booleano", classe: "status" },
                { campo: "novidade_ate", titulo: "Recém-chegado até", tipo: "data", classe: "date" },
                { campo: "esgotado", titulo: "Esgotado", tipo: "booleano", classe: "status" },
                { campo: "sob_demanda", titulo: "Sob demanda / encomenda", tipo: "booleano", classe: "status" },
                { campo: "prazo_reposicao", titulo: "Prazo de reposição" },
                { campo: "created_at", titulo: "Cadastrado em", tipo: "datahora", classe: "date" }
            ];
            const linhas = produtos.map(produto => {
                const linha = {};
                colunas.forEach(coluna => {
                    linha[coluna.campo] = valorPerfumeExportacao(produto, coluna);
                });
                return linha;
            });
            const html = montarPlanilhaHTML({
                titulo: "Primor Poços - Catálogo de Perfumes",
                subtitulo: "Planilha operacional para conferência de perfumes, imagens, notas e disponibilidade",
                colunas,
                linhas
            });
            baixarArquivo(`primor-catalogo-${data}.xls`, `\ufeff${html}`, "application/vnd.ms-excel;charset=utf-8");
            return;
        }

        baixarArquivo(
            `primor-perfumes-${data}.json`,
            JSON.stringify(produtos, null, 2),
            "application/json;charset=utf-8"
        );
    } catch (error) {
        console.error(error);
        alert("Não foi possível exportar o banco agora.");
    }
}

async function exportarClientesPlanilha() {
    const senhaAdmin = sessionStorage.getItem("admin_senha");

    if (!senhaAdmin) {
        alert("Entre novamente no painel antes de exportar clientes.");
        logout();
        return;
    }

    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exportar_clientes_admin`, {
            method: "POST",
            headers,
            body: JSON.stringify({ p_senha: senhaAdmin })
        });

        if (!response.ok) throw new Error(await response.text());
        const clientes = await response.json();

        const data = new Date().toISOString().slice(0, 10);
        const colunas = [
            { campo: "id", titulo: "ID", classe: "id" },
            { campo: "nome", titulo: "Nome completo", tipo: "nome" },
            { campo: "email", titulo: "E-mail" },
            { campo: "telefone", titulo: "Telefone", tipo: "texto", classe: "phone" },
            { campo: "cpf", titulo: "CPF", tipo: "texto", classe: "phone" },
            { campo: "data_nascimento", titulo: "Nascimento", tipo: "data", classe: "date" },
            { campo: "origem", titulo: "Origem", tipo: "origem" },
            { campo: "created_at", titulo: "Criado em", tipo: "datahora", classe: "date" },
            { campo: "updated_at", titulo: "Atualizado em", tipo: "datahora", classe: "date" }
        ];
        const linhas = clientes.map(cliente => {
            const linha = {};
            colunas.forEach(coluna => {
                linha[coluna.campo] = valorClienteExportacao(cliente, coluna);
            });
            return linha;
        });
        const html = montarPlanilhaHTML({
            titulo: "Primor Poços - Clientes",
            subtitulo: "Planilha operacional para atendimento, cadastro externo e acompanhamento de clientes",
            colunas,
            linhas
        });

        baixarArquivo(`primor-clientes-${data}.xls`, `\ufeff${html}`, "application/vnd.ms-excel;charset=utf-8");
    } catch (error) {
        console.error(error);
        alert("Não foi possível exportar clientes. Confira se o SQL supabase/sql/primor_rls_producao.sql foi aplicado no Supabase.");
    }
}

async function exportarClientesCSV() {
    return exportarClientesPlanilha();
}

async function exportarRelatorioGerencial() {
    try {
        const produtos = cacheProdutosAdmin.length ? cacheProdutosAdmin : cacheProdutos;
        const grupos = [...agruparProdutosAdmin(produtos).values()];
        const data = new Date().toISOString().slice(0, 10);

        const marcas = new Map();
        grupos.forEach(grupo => {
            if (!marcas.has(grupo.marca)) {
                marcas.set(grupo.marca, {
                    marca: grupo.marca,
                    perfumes: 0,
                    variacoes: 0,
                    vitrine: 0,
                    novidades: 0,
                    esgotados: 0,
                    encomenda: 0,
                    semImagem: 0,
                    semNotas: 0
                });
            }

            const resumo = marcas.get(grupo.marca);
            resumo.perfumes += 1;
            resumo.variacoes += grupo.variacoes.length;
            resumo.vitrine += grupo.destaque ? 1 : 0;
            resumo.novidades += grupo.novidade ? 1 : 0;
            resumo.esgotados += grupo.esgotado ? 1 : 0;
            resumo.encomenda += grupo.sob_demanda ? 1 : 0;
            resumo.semImagem += normalizarImagemProduto(grupo.imagem) ? 0 : 1;
            resumo.semNotas += String(grupo.notas || "").trim() ? 0 : 1;
        });

        const totalVitrine = grupos.filter(grupo => grupo.destaque).length;
        const totalNovidades = grupos.filter(grupo => grupo.novidade).length;
        const totalEsgotados = grupos.filter(grupo => grupo.esgotado).length;
        const totalEncomenda = grupos.filter(grupo => grupo.sob_demanda).length;
        const totalSemImagem = grupos.filter(grupo => !normalizarImagemProduto(grupo.imagem)).length;
        const totalSemNotas = grupos.filter(grupo => !String(grupo.notas || "").trim()).length;

        const pendencias = grupos
            .filter(grupo => !normalizarImagemProduto(grupo.imagem) || !String(grupo.notas || "").trim() || grupo.esgotado || grupo.sob_demanda)
            .map(grupo => ({
                perfume: grupo.nome,
                marca: grupo.marca,
                volumes: grupo.volumes.length ? grupo.volumes.map(v => `${v}ml`).join(", ") : "Sem volume",
                revisar: [
                    !normalizarImagemProduto(grupo.imagem) ? "Sem imagem" : "",
                    !String(grupo.notas || "").trim() ? "Sem notas" : "",
                    grupo.esgotado ? "Esgotado" : "",
                    grupo.sob_demanda ? "Sob demanda" : ""
                ].filter(Boolean).join(", ")
            }));

        const secoes = [
            {
                titulo: "Visão geral",
                colunas: [
                    { campo: "indicador", titulo: "Indicador" },
                    { campo: "valor", titulo: "Valor" },
                    { campo: "leitura", titulo: "Leitura rápida" }
                ],
                linhas: [
                    { indicador: "Perfumes agrupados", valor: grupos.length, leitura: "Quantidade de perfumes únicos, sem repetir volumes." },
                    { indicador: "Variações cadastradas", valor: produtos.length, leitura: "Total de itens no banco, incluindo diferentes ml." },
                    { indicador: "Marcas ativas", valor: marcas.size, leitura: "Marcas presentes no catálogo." },
                    { indicador: "Itens para revisar", valor: totalSemImagem + totalSemNotas + totalEsgotados + totalEncomenda, leitura: "Soma de alertas operacionais do catálogo." }
                ]
            },
            {
                titulo: "Status do catálogo",
                colunas: [
                    { campo: "status", titulo: "Status" },
                    { campo: "quantidade", titulo: "Quantidade" },
                    { campo: "observacao", titulo: "Observação" }
                ],
                linhas: [
                    { status: "Mais procurados", quantidade: totalVitrine, observacao: "Produtos destacados na home e catálogo." },
                    { status: "Recém-chegados", quantidade: totalNovidades, observacao: "Produtos marcados como novidade dentro do prazo." },
                    { status: "Esgotados", quantidade: totalEsgotados, observacao: "Produtos sem disponibilidade imediata." },
                    { status: "Sob demanda / encomenda", quantidade: totalEncomenda, observacao: "Produtos que dependem de prazo ou pedido." },
                    { status: "Sem imagem", quantidade: totalSemImagem, observacao: "Produtos que precisam de imagem." },
                    { status: "Sem notas", quantidade: totalSemNotas, observacao: "Produtos que precisam de notas olfativas." }
                ]
            },
            {
                titulo: "Resumo por marca",
                colunas: [
                    { campo: "marca", titulo: "Marca" },
                    { campo: "perfumes", titulo: "Perfumes" },
                    { campo: "variacoes", titulo: "Variações" },
                    { campo: "alertas", titulo: "Alertas" }
                ],
                linhas: [...marcas.values()]
                    .sort((a, b) => compararTextoPtBr(a.marca, b.marca))
                    .map(item => ({
                        marca: item.marca,
                        perfumes: item.perfumes,
                        variacoes: item.variacoes,
                        alertas: `${item.semImagem} sem imagem, ${item.semNotas} sem notas, ${item.esgotados} esgotado(s), ${item.encomenda} sob demanda`
                    }))
            },
            {
                titulo: "Pendências prioritárias",
                colunas: [
                    { campo: "perfume", titulo: "Perfume" },
                    { campo: "marca", titulo: "Marca" },
                    { campo: "volumes", titulo: "Volumes" },
                    { campo: "revisar", titulo: "Revisar" }
                ],
                linhas: pendencias
            }
        ];

        baixarArquivo(
            `primor-relatorio-gerencial-${data}.xls`,
            `\ufeff${montarRelatorioGerencialHTML({ secoes })}`,
            "application/vnd.ms-excel;charset=utf-8"
        );
    } catch (error) {
        console.error(error);
        alert("Não foi possível gerar o relatório gerencial agora.");
    }
}

async function carregarMarcas() {
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/marcas?order=nome.asc`, {
            method: "GET",
            headers: headers
        });

        if (!response.ok) throw new Error("Erro ao buscar marcas.");
        const marcas = await response.json();

        const optionsMarcas = marcas.map(m => {
            const nome = escaparHTML(m.nome);
            return `<option value="${nome}">${nome}</option>`;
        }).join("");

        // Select no formulário de Cadastro/Edição de Perfumes
        const selectMarca = document.getElementById("marca");
        if (selectMarca) {
            const valorAtual = selectMarca.value;
            selectMarca.innerHTML = `<option value="">Selecione uma Marca</option>${optionsMarcas}`;
            if (valorAtual) selectMarca.value = valorAtual;
        }

        // Filtro de marca no Admin
        const filtroMarcaAdmin = document.getElementById("filtro-marca-admin");
        if (filtroMarcaAdmin) {
            const valorAtual = filtroMarcaAdmin.value;
            filtroMarcaAdmin.innerHTML = `<option value="">Todas as marcas</option>${optionsMarcas}`;
            if (valorAtual) filtroMarcaAdmin.value = valorAtual;
        }

        const filtroMarcasLateral = document.getElementById("filtro-marcas-lateral");
        if (filtroMarcasLateral) {
            const valorAtual = marcaLateralAdmin;
            filtroMarcasLateral.innerHTML = `<button type="button" class="active" data-marca="" onclick="filtrarMarcaLateralAdmin('')">Todas</button>`;
            marcas.forEach(m => {
                const nomeMarca = escaparHTML(m.nome);
                const marcaJS = escaparAtributoJS(m.nome);
                filtroMarcasLateral.innerHTML += `<button type="button" data-marca="${nomeMarca}" onclick="filtrarMarcaLateralAdmin('${marcaJS}')">${nomeMarca}</button>`;
            });
            marcaLateralAdmin = marcas.some(m => m.nome === valorAtual) ? valorAtual : "";
            filtrarMarcaLateralAdmin(marcaLateralAdmin);
        }

        // Dropdown de Marcas na Vitrine
        const dropdownMarcas = document.getElementById("dropdown-marcas");
        if (dropdownMarcas) {
            dropdownMarcas.innerHTML = `
                <a href="#" onclick="filtrarMarca('')" style="font-weight: bold; border-bottom: 1px solid rgba(197,160,89,0.18);">Todas as Marcas</a>
                <a href="#" onclick="filtrarNovidades()" style="font-weight: bold; color: #c5a059;">Recém chegados</a>
            `;
            marcas.forEach(m => {
                const nomeMarca = escaparHTML(m.nome);
                const marcaJS = escaparAtributoJS(m.nome);
                dropdownMarcas.innerHTML += `<a href="#" onclick="filtrarMarca('${marcaJS}')">${nomeMarca}</a>`;
            });
        }

        const brandFilterList = document.getElementById("brand-filter-list");
        if (brandFilterList) {
            brandFilterList.innerHTML = `
                <button type="button" class="brand-chip active" data-marca="" onclick="filtrarMarca('')">Todas</button>
                <button type="button" class="brand-chip brand-chip-novidade" data-filtro="novidades" onclick="filtrarNovidades()">Recém chegados</button>
            `;
            marcas.forEach(m => {
                const nomeMarca = escaparHTML(m.nome);
                const marcaJS = escaparAtributoJS(m.nome);
                brandFilterList.innerHTML += `<button type="button" class="brand-chip" data-marca="${nomeMarca}" onclick="filtrarMarca('${marcaJS}')">${nomeMarca}</button>`;
            });
        }

        // Lista de gerenciamento de marcas dentro do Admin
        const listaMarcasAdmin = document.getElementById("lista-marcas-admin");
        if (listaMarcasAdmin) {
            listaMarcasAdmin.innerHTML = "";
            if (marcas.length === 0) {
                listaMarcasAdmin.innerHTML = "<span style='color:#777; font-size:13px;'>Nenhuma marca cadastrada.</span>";
            } else {
                marcas.forEach(m => {
                    const nomeMarca = escaparHTML(m.nome);
                    const marcaJS = escaparAtributoJS(m.nome);
                    listaMarcasAdmin.innerHTML += `
                        <div class="admin-brand-pill">
                            <span>${nomeMarca}</span>
                            <div class="admin-brand-actions">
                                <button class="admin-brand-edit" onclick="editarMarca(${m.id}, '${marcaJS}')" title="Editar marca">Editar</button>
                                <button class="admin-brand-delete" onclick="deletarMarca(${m.id})" title="Excluir marca">&times;</button>
                            </div>
                        </div>
                    `;
                });
            }
        }

    } catch (error) {
        console.error("Erro ao processar marcas:", error);
    }
}

// Inicializa a carga de marcas ao carregar a página principal
document.addEventListener("DOMContentLoaded", () => {
    carregarMarcas();
});

// Cadastra uma nova marca no Supabase
async function salvarMarca() {
    const editId = document.getElementById("marca-edit-id")?.value || "";

    if (editId) {
        await atualizarMarca(editId);
        return;
    }

    await cadastrarMarca();
}

function editarMarca(id, nome) {
    const inputMarca = document.getElementById("nova-marca-nome");
    const inputId = document.getElementById("marca-edit-id");
    const inputNomeOriginal = document.getElementById("marca-edit-nome-original");
    const botaoSalvar = document.getElementById("btn-salvar-marca");
    const botaoCancelar = document.getElementById("btn-cancelar-marca");

    if (!inputMarca || !inputId || !botaoSalvar || !botaoCancelar) return;

    inputMarca.value = nome;
    inputId.value = id;
    if (inputNomeOriginal) inputNomeOriginal.value = nome;
    botaoSalvar.textContent = "Salvar Marca";
    botaoCancelar.style.display = "inline-flex";
    inputMarca.focus();
}

function cancelarEdicaoMarca() {
    const inputMarca = document.getElementById("nova-marca-nome");
    const inputId = document.getElementById("marca-edit-id");
    const inputNomeOriginal = document.getElementById("marca-edit-nome-original");
    const botaoSalvar = document.getElementById("btn-salvar-marca");
    const botaoCancelar = document.getElementById("btn-cancelar-marca");

    if (inputMarca) inputMarca.value = "";
    if (inputId) inputId.value = "";
    if (inputNomeOriginal) inputNomeOriginal.value = "";
    if (botaoSalvar) botaoSalvar.textContent = "Adicionar Marca";
    if (botaoCancelar) botaoCancelar.style.display = "none";
}

async function cadastrarMarca() {
    const inputMarca = document.getElementById("nova-marca-nome");
    const nomeMarca = inputMarca.value.trim();

    if (!nomeMarca) {
        alert("Digite o nome da marca para adicionar.");
        return;
    }

    try {
        await chamarRpcAdmin("admin_upsert_marca", {
            p_id: null,
            p_nome: nomeMarca
        });
        cancelarEdicaoMarca();
        alert("Marca cadastrada com sucesso!");
        await carregarMarcas(); // Recarrega todas as listas de marcas
    } catch (error) {
        console.error(error);
        alert("Não foi possível cadastrar a marca.");
    }
}

async function atualizarMarca(id) {
    const inputMarca = document.getElementById("nova-marca-nome");
    const inputNomeOriginal = document.getElementById("marca-edit-nome-original");
    const nomeMarca = inputMarca.value.trim();
    const nomeOriginal = inputNomeOriginal?.value?.trim() || "";

    if (!nomeMarca) {
        alert("Digite o novo nome da marca.");
        return;
    }

    try {
        await chamarRpcAdmin("admin_upsert_marca", {
            p_id: Number(id),
            p_nome: nomeMarca
        });

        if (nomeOriginal && nomeOriginal !== nomeMarca) {
            const produtosParaAtualizar = cacheProdutosAdmin.filter(produto =>
                compararTextoPtBr(obterMarcaProduto(produto), nomeOriginal) === 0
            );

            for (const produto of produtosParaAtualizar) {
                await chamarRpcAdmin("admin_upsert_perfume", montarPayloadPerfumeAdmin({
                    ...produto,
                    marca: nomeMarca
                }, produto.id));
            }

            cacheProdutos = cacheProdutos.map(produto =>
                compararTextoPtBr(obterMarcaProduto(produto), nomeOriginal) === 0
                    ? { ...produto, marca: nomeMarca }
                    : produto
            );
            cacheProdutosAdmin = cacheProdutosAdmin.map(produto =>
                compararTextoPtBr(obterMarcaProduto(produto), nomeOriginal) === 0
                    ? { ...produto, marca: nomeMarca }
                    : produto
            );
        }

        cancelarEdicaoMarca();
        alert("Marca atualizada com sucesso! Os perfumes vinculados também foram ajustados.");
        await carregarMarcas();
        if (document.getElementById("product-list")) renderizarProdutos(cacheProdutos);
        if (document.getElementById("lista-admin")) renderizarProdutosAdmin(cacheProdutosAdmin);
    } catch (error) {
        console.error(error);
        alert("Não foi possível atualizar a marca.");
    }
}

// Remove uma marca do banco de dados
async function deletarMarca(id) {
    if (!confirm("Tem certeza que deseja remover esta marca? Os perfumes desta marca não serão apagados, mas ficarão sem categoria correspondente.")) return;

    try {
        await chamarRpcAdmin("admin_delete_marca", { p_id: Number(id) });

        alert("Marca removida com sucesso!");
        await carregarMarcas(); // Atualiza as listagens
    } catch (error) {
        console.error(error);
        alert("Erro ao excluir marca.");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    preencherFormularioCliente("cliente-login");
    preencherFormularioCliente("cliente");
    atualizarBotaoLoginCliente();
    atualizarPreviewCliente();
    definirStatusCliente();
    sincronizarClienteAutenticado();

    ["cliente-login-nome", "cliente-login-telefone", "cliente-login-email-form"].forEach(id => {
        document.getElementById(id)?.addEventListener("input", () => atualizarPreviewCliente());
    });

    if (supabaseClient) {
        supabaseClient.auth.onAuthStateChange(async (event, session) => {
            if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
                await aplicarSessaoCliente(session, event === "SIGNED_IN" ? "confirmacao_email" : "login_auth");
                if (event === "SIGNED_IN") {
                    definirFeedbackCliente("Cadastro confirmado com sucesso.", "sucesso");
                }
            }
        });
    }

    document.getElementById("imagem")?.addEventListener("input", atualizarPreviewImagemAdmin);
    document.getElementById("nome")?.addEventListener("blur", sugerirImagemPorGrupo);
    document.getElementById("marca")?.addEventListener("change", sugerirImagemPorGrupo);
    document.getElementById("novidade")?.addEventListener("change", event => {
        const novidadeAte = document.getElementById("novidade-ate");
        if (!novidadeAte) return;
        novidadeAte.value = event.target.checked ? (novidadeAte.value || adicionarDiasISO(15)) : "";
    });
    document.getElementById("busca-admin")?.addEventListener("input", filtrarAdmin);
    document.getElementById("filtro-marca-admin")?.addEventListener("change", filtrarAdmin);
    document.getElementById("filtro-status-admin")?.addEventListener("change", filtrarAdmin);
    document.getElementById("busca-admin-lateral")?.addEventListener("input", renderizarCatalogoLateralAdmin);
});
