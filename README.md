# DataVision BI — versão inicial

Aplicação web local para importar planilhas Excel de vendas e visualizar indicadores gerenciais. A interface é responsiva e oferece login individual, histórico de importações, comparativo de vendas por exercício e administração de usuários.

## Tecnologias

- Frontend: React, Vite, Recharts e CSS responsivo.
- API: Node.js, Fastify, JWT e processamento de Excel com SheetJS (`xlsx`).
- Banco: PostgreSQL + Prisma.
- Execução: Docker Compose.

## Requisitos

- Windows 10/11 ou Linux.
- Docker Desktop com Docker Compose (ou Docker Engine + Compose).
- Navegador atualizado.

Na primeira inicialização, o Docker precisará baixar as imagens e instalar dependências. Depois, os serviços poderão ser iniciados localmente.

## Instalação no Windows

1. Extraia o ZIP para uma pasta, por exemplo `C:\DataVisionBI`.
2. Copie `.env.example` para um arquivo chamado `.env` na mesma pasta do `docker-compose.yml`.
3. Edite `.env` e defina senhas fortes. Exemplo:

```env
DB_PASSWORD=senhaForteSomenteLetrasENumeros2026
JWT_SECRET=uma_chave_aleatoria_com_mais_de_32_caracteres
ADMIN_NAME=Administrador
ADMIN_EMAIL=admin@local
ADMIN_PASSWORD=uma_senha_forte_com_10_ou_mais_caracteres
```

4. Abra o PowerShell nessa pasta e execute:

```powershell
docker compose up -d --build
```

5. Aguarde os containers ficarem ativos e acesse `http://localhost:8080`.
6. Entre com o e-mail e senha definidos em `.env`.
7. Clique em **Importar Excel** e selecione `.xls` ou `.xlsx`.

Para interromper sem apagar os dados:

```powershell
docker compose down
```

Para iniciar novamente:

```powershell
docker compose up -d
```

## Acesso por outros computadores da rede

Depois de validar o acesso no próprio servidor, outros computadores podem usar `http://IP-DO-SERVIDOR:8080`. Reserve um IP para o servidor e libere a porta TCP 8080 somente na rede interna, no firewall. Não publique diretamente na internet sem HTTPS, política de acesso e revisão de segurança.

## Funcionamento

- Cada usuário tem sua própria conta e visualiza suas próprias importações.
- O primeiro usuário administrador é criado automaticamente na primeira inicialização.
- Administradores podem cadastrar usuários com perfil de administrador ou usuário comum, além de ativar/desativar contas.
- O upload aceita arquivos `.xls` e `.xlsx`, com limite de 10 MB.
- O histórico mantém as importações anteriores. O dashboard usa a importação mais recente do usuário logado.
- A senha é armazenada com hash bcrypt; a API utiliza token JWT com validade de 8 horas.
- Os dados são armazenados no volume persistente `datavision_data` do PostgreSQL.

## Layout esperado da planilha

A primeira aba deve conter um cabeçalho com colunas equivalentes a:

- Mês
- Vl. Venda 2026, Vl. Venda 2025, Vl. Venda 2024
- Vl. devolução e %Devolução
- Vl. venda líquida
- Vl. CMV venda, Vl. CMV devolução e Vl. CMV líquido
- Vl. lucro e %Lucro
- Qt. positivado

O leitor localiza o cabeçalho nas primeiras 12 linhas e ignora a linha Total. A planilha enviada foi incluída em `examples/` como referência de layout.

## Observação sobre os dados do arquivo de referência

O arquivo `VendasMesaMes2026.xls` traz vendas comparativas para 2024, 2025 e 2026. Os campos de venda líquida, CMV, lucro e devoluções são apresentados somente para 2026. O dashboard sinaliza essa limitação ao selecionar 2024 ou 2025, evitando apresentar métricas de 2026 como se fossem históricas.

## Backup

Para gerar um backup lógico do banco:

```powershell
docker compose exec -T db pg_dump -U datavision -d datavision > backup-datavision.sql
```

Para restaurar em uma instalação vazia:

```powershell
Get-Content backup-datavision.sql | docker compose exec -T db psql -U datavision -d datavision
```

Guarde o `.env` e o backup em local seguro. Não compartilhe credenciais reais.

## Próximas melhorias recomendadas

1. Testes automatizados de importação e regras de cálculo.
2. Exportação de relatórios em PDF/Excel.
3. Auditoria de alterações e redefinição de senha.
4. Permitir mapear colunas quando a origem tiver outro layout.
5. Política de retenção, backup agendado e HTTPS caso seja disponibilizado fora da rede interna.
