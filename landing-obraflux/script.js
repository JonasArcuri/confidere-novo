const modal = document.querySelector("[data-lead-modal]");
const form = document.querySelector("[data-lead-form]");
const openButtons = document.querySelectorAll("[data-open-lead-modal]");
const closeButton = document.querySelector("[data-close-lead-modal]");
const moduleLab = document.querySelector("[data-module-lab]");
const imageZoom = document.querySelector("[data-image-zoom]");
const openModuleZoomButton = document.querySelector("[data-open-module-zoom]");
const closeImageZoomButton = document.querySelector("[data-close-image-zoom]");

const whatsappNumber = "5547999065181";
const modules = {
  orcamentos: {
    category: "Orçamentos",
    title: "Monte propostas com itens, áreas, materiais e mão de obra",
    description: "Centralize dados do cliente, endereço, validade e composição do serviço para chegar ao total com mais segurança.",
    image: "assets/prints/01-novo-orcamento-editor.png",
    alt: "Tela de novo orçamento do ObraFlux com dados do cliente e itens do orçamento",
    points: [
      "Envie o PDF do orçamento diretamente ao cliente.",
      "Escolha o formato em modo retrato ou paisagem.",
      "Mantenha materiais, mão de obra e totais no mesmo fluxo.",
    ],
  },
  obras: {
    category: "Obras",
    title: "Controle cada frente em andamento sem perder contexto",
    description: "Acompanhe obras por status, cliente, responsável, endereço e data de início, mantendo cada frente bem localizada.",
    image: "assets/prints/09-obras-lista.png",
    alt: "Lista de obras do ObraFlux com status, cliente, responsável e endereço",
    points: [
      "Visualize obras em execução, finalizadas e pendentes.",
      "Abra o resumo completo da frente quando precisar.",
      "Conecte orçamento, cronograma e responsáveis no mesmo histórico.",
    ],
  },
  agenda: {
    category: "Agenda e equipe",
    title: "Distribua visitas, tarefas e compromissos do time",
    description: "Organize visitas, entregas, compras e compromissos da equipe em uma visão simples de calendário.",
    image: "assets/prints/05-calendario-agendamentos.png",
    alt: "Calendário de agendamentos do ObraFlux com compromissos por dia",
    points: [
      "Planeje o mês antes de colocar a equipe em campo.",
      "Mantenha funcionários e responsáveis cadastrados.",
      "Reduza desencontros entre atendimento, obra e execução.",
    ],
  },
  insumos: {
    category: "Insumos e despesas",
    title: "Custos registrados por tipo, mês e responsável",
    description: "Registre materiais, alimentação, transporte, equipamentos e outros custos ligados à execução dos serviços.",
    image: "assets/prints/08-insumos-despesas.png",
    alt: "Tela de insumos e despesas do ObraFlux com filtros e lançamentos por valor",
    points: [
      "Envie fotos de comprovantes para consulta posterior.",
      "Filtre despesas por tipo, funcionário e mês.",
      "Mantenha custos organizados enquanto a obra acontece.",
    ],
  },
  relatorios: {
    category: "Relatórios de obra",
    title: "Registre a execução e gere histórico confiável",
    description: "Documente atividades, avanços e informações relevantes para manter o acompanhamento de cada serviço mais claro.",
    image: "assets/prints/07-relatorios-obra.png",
    alt: "Tela de relatórios de obra do ObraFlux",
    points: [
      "Registre evolução, ocorrências e observações da obra.",
      "Acompanhe cobranças e medições vinculadas ao serviço.",
      "Tenha um histórico organizado para consultar depois.",
    ],
  },
  financeiro: {
    category: "Fluxo financeiro",
    title: "Entenda entradas, saídas e comparativos do mês",
    description: "Veja entradas, saídas, saldo do mês, custos por insumos e relatórios comparativos para decidir com mais segurança.",
    image: "assets/prints/11-fluxo-financeiro-dashboard.png",
    alt: "Dashboard financeiro do ObraFlux com entradas, saídas, saldo e gráficos",
    points: [
      "Compare meses e enxergue variações financeiras.",
      "Gere PDFs dos relatórios mensais para planejar melhor.",
      "Centralize receitas, despesas e saldos da operação.",
    ],
  },
};

function updateModule(key) {
  const selectedModule = modules[key];
  if (!selectedModule || !moduleLab) {
    return;
  }

  const image = moduleLab.querySelector("[data-module-image]");
  const label = moduleLab.querySelector("[data-module-screen-label]");
  const category = moduleLab.querySelector("[data-module-category]");
  const title = moduleLab.querySelector("[data-module-title]");
  const description = moduleLab.querySelector("[data-module-description]");
  const points = moduleLab.querySelector("[data-module-points]");

  moduleLab.querySelectorAll("[data-module-key]").forEach((button) => {
    const isActive = button.dataset.moduleKey === key;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  image.classList.remove("is-changing");
  void image.offsetWidth;
  image.src = selectedModule.image;
  image.alt = selectedModule.alt;
  image.classList.add("is-changing");

  label.textContent = selectedModule.category;
  category.textContent = selectedModule.category;
  title.textContent = selectedModule.title;
  description.textContent = selectedModule.description;
  points.innerHTML = selectedModule.points.map((point) => `<li>${point}</li>`).join("");
}

function openImageZoom() {
  if (!moduleLab || !imageZoom) {
    return;
  }

  const image = moduleLab.querySelector("[data-module-image]");
  const category = moduleLab.querySelector("[data-module-category]");
  const zoomImage = imageZoom.querySelector("[data-zoom-image]");
  const zoomTitle = imageZoom.querySelector("[data-zoom-title]");

  zoomImage.src = image.src;
  zoomImage.alt = image.alt;
  zoomTitle.textContent = category.textContent;
  imageZoom.hidden = false;
  document.body.classList.add("modal-open");
  closeImageZoomButton?.focus();
}

function closeImageZoom() {
  if (!imageZoom) {
    return;
  }

  imageZoom.hidden = true;
  document.body.classList.remove("modal-open");
  openModuleZoomButton?.focus();
}

if (moduleLab) {
  moduleLab.querySelectorAll("[data-module-key]").forEach((button) => {
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(button.classList.contains("is-active")));
    button.addEventListener("click", () => updateModule(button.dataset.moduleKey));
  });
}

openModuleZoomButton?.addEventListener("click", openImageZoom);
closeImageZoomButton?.addEventListener("click", closeImageZoom);

imageZoom?.addEventListener("click", (event) => {
  if (event.target === imageZoom) {
    closeImageZoom();
  }
});

function openModal() {
  modal.hidden = false;
  document.body.classList.add("modal-open");
  form.elements.nome.focus();
}

function closeModal() {
  modal.hidden = true;
  document.body.classList.remove("modal-open");
}

function buildWhatsappUrl({ empresa, servico, local }) {
  const message = `Olá, gostaria de saber mais sobre o ObraFlux! Minha empresa é a ${empresa} e realizo ${servico} em ${local}.`;
  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
}

openButtons.forEach((button) => {
  button.addEventListener("click", openModal);
});

closeButton.addEventListener("click", closeModal);

modal.addEventListener("click", (event) => {
  if (event.target === modal) {
    closeModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && imageZoom && !imageZoom.hidden) {
    closeImageZoom();
    return;
  }

  if (event.key === "Escape" && !modal.hidden) {
    closeModal();
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const lead = {
    empresa: String(formData.get("empresa")).trim(),
    servico: String(formData.get("servico")).trim(),
    local: String(formData.get("local")).trim(),
  };

  window.location.href = buildWhatsappUrl(lead);
  closeModal();
});
