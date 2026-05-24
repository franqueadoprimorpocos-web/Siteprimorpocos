const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const output = path.join(root, "public");

function copyRecursive(source, destination) {
    const stats = fs.statSync(source);

    if (stats.isDirectory()) {
        fs.mkdirSync(destination, { recursive: true });
        fs.readdirSync(source).forEach((item) => {
            copyRecursive(path.join(source, item), path.join(destination, item));
        });
        return;
    }

    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
}

if (fs.existsSync(output)) {
    fs.rmSync(output, { recursive: true, force: true });
}

fs.mkdirSync(output, { recursive: true });

["index.html", "admin.html", "robots.txt", "sw.js"].forEach((file) => {
    const source = path.join(root, file);
    if (fs.existsSync(source)) {
        copyRecursive(source, path.join(output, file));
    }
});

copyRecursive(path.join(root, "assets"), path.join(output, "assets"));

console.log(`Arquivos públicos preparados em ${output}`);
