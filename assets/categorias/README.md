Pacotes `.comapeocat` **interinos** (fixtures canônicas de teste) emitidos por `scripts/gerar-manifestos-pacotes.mjs --emitir-fixtures` até a entrega dos pacotes aprovados da #30.
`manifestos.generated.json` é regerado a partir destes arquivos por `npm run build:manifestos-pacotes` (o `ref.hash` do manifesto é o sha256 deles).
Para trocar: sobrescreva os dois arquivos pelos pacotes reais e regere com
`node ./scripts/gerar-manifestos-pacotes.mjs --monitoramento assets/categorias/monitoramento.comapeocat --alertas assets/categorias/alertas.comapeocat`.
