export const SEED_TEXTS = [
  "A velocidade não importa se você está digitando errado, pois será preciso apagar tudo e começar novamente do ponto onde o erro apareceu.",
  "O sol nasceu atrás das montanhas enquanto os pássaros cantavam uma melodia suave, anunciando o começo de mais um dia tranquilo na cidade pequena.",
  "Programar exige paciência, atenção aos detalhes e a capacidade de resolver problemas complexos, transformando ideias abstratas em código funcional.",
  "A tecnologia avança rapidamente e novas ferramentas surgem todos os dias, mudando a forma como as pessoas trabalham, se comunicam e se divertem.",
  "Correr uma maratona exige meses de treino, disciplina alimentar e força mental para superar o cansaço nos últimos quilômetros da prova.",
  "Um bom café pela manhã pode transformar completamente o humor de uma pessoa e prepará-la para enfrentar os desafios do dia com mais energia.",
  "A biblioteca antiga guardava milhares de livros empoeirados, cada um contando uma história diferente sobre mundos distantes e personagens inesquecíveis.",
  "Aprender a digitar rápido e com precisão é uma habilidade valiosa que economiza tempo e reduz o esforço em tarefas do dia a dia no computador.",
  "As estrelas brilhavam intensamente no céu escuro do deserto, formando constelações que os viajantes usavam para se orientar durante a noite.",
  "Cozinhar é uma arte que combina criatividade, técnica e paciência, transformando ingredientes simples em pratos deliciosos e cheios de sabor.",
  "O oceano esconde mistérios profundos que a ciência ainda não conseguiu explicar completamente, desde criaturas bioluminescentes até correntes gigantes.",
  "Viajar pelo mundo abre a mente para novas culturas, idiomas e formas de pensar, tornando cada pessoa mais tolerante e curiosa sobre a vida.",
];

export function pickRandomText(db) {
  const row = db
    .prepare("SELECT id, content FROM texts ORDER BY RANDOM() LIMIT 1")
    .get();
  return row;
}

// Syncs the seed list into the table by position: updates existing rows in
// place (so accent/wording fixes reach the DB without breaking the foreign
// key that rooms.text_id holds on old ones) and inserts any new entries.
export function syncSeedTexts(db) {
  const existing = db.prepare("SELECT id FROM texts ORDER BY id").all();
  const insert = db.prepare("INSERT INTO texts (content, lang) VALUES (?, 'pt')");
  const update = db.prepare("UPDATE texts SET content = ? WHERE id = ?");

  const tx = db.transaction((texts) => {
    texts.forEach((content, i) => {
      if (existing[i]) {
        update.run(content, existing[i].id);
      } else {
        insert.run(content);
      }
    });
  });
  tx(SEED_TEXTS);
}
