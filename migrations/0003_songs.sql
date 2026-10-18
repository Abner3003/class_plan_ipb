CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO songs(title,text) VALUES
('Música 1 — Alô, Noah!','Música 1 — Alô, Noah!
Alô, Noah! Como vai, Noah?
Que bom que você veio!
Gosto muito de você!
Lembrar das mamães.'),
('Música 2 — Começou a aula','Música 2 — Começou a aula
Começou a aula
Nós vamos cantar
Pedir ao Papai do Céu
Para ajudar
A nossa titia que vai ensinar
Com tanto carinho
A gente a orar
Embora pequeno
Vou obedecer
E tudo que a tia falar
Vou fazer
Nesse lindo dia
Eu vou aprender
E a Deus com carinho
Vou agradecer.'),
('Música 3 — Olá, olá','Música 3 — Olá, olá
Olá, olá
Agora vou falar
Da Palavra que é vida
E nos ensina a caminhar
É assim, esse livro
Deus nos deu para o ensino
É a Bíblia, a verdade
Que nos leva à liberdade.');
