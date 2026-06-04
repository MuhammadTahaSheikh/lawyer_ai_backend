# Lawyer AI Backend

Node.js API for the Lawyer AI CMS (cases, documents, tickets, Supabase auth, and related services).

## Repository

- **Primary (your fork):** https://github.com/MuhammadTahaSheikh/lawyer_ai_backend.git
- **Upstream (original):** https://github.com/ymesadev/cms-backend-dev.git

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your database and Supabase credentials
npm start
```

## Remotes (this working copy)

| Remote | URL | Use |
|--------|-----|-----|
| `lawyer-backend` | MuhammadTahaSheikh/lawyer_ai_backend | Push your changes |
| `origin` | ymesadev/cms-backend-dev | Original upstream |

Push to your repo:

```bash
git push lawyer-backend main
```

## Clone into the monorepo folder

From the `lawyer_ai` workspace root:

```bash
git clone https://github.com/MuhammadTahaSheikh/lawyer_ai_backend.git laywer-ai-backend/cms-backend-dev
```

The frontend app lives separately in `laywer-ai/` and is not part of this repository.
