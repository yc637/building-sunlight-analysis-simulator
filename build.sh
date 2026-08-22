#!/bin/bash
# 打包成单文件 bundle.js（双击 index.html 即可运行，无需服务器）
cd "$(dirname "$0")"
npx --yes esbuild scene.js --bundle --format=iife --alias:three=./vendor/three.module.js --outfile=bundle.js
echo "打包完成: bundle.js"
