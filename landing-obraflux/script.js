const modal = document.querySelector("[data-lead-modal]");
const form = document.querySelector("[data-lead-form]");
const openButtons = document.querySelectorAll("[data-open-lead-modal]");
const closeButton = document.querySelector("[data-close-lead-modal]");

const whatsappNumber = "5547999065181";

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
