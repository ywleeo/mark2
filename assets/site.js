/** Keep explicit language switches on the corresponding section when possible. */
const switchLink = document.querySelector(".language");
if (switchLink) {
  switchLink.addEventListener("click", () => {
    const hash = window.location.hash;
    if (hash)
      switchLink.href =
        new URL(
          switchLink.getAttribute("href"),
          window.location.href,
        ).href.split("#")[0] + hash;
  });
}
