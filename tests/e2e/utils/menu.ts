// #118 removed the header's drawer button (`HOME.header-button` /
// `~Open Menu`). The menu content is now the first tab's page ("Menu"),
// opened by the tab bar's Menu button — accessibility label "Go to menu."
// (see src/frontend/Navigation/Tab/TabBar.tsx). Every spec that used to open
// the drawer now calls this single helper instead.
export const abrirMenu = async () => {
  await $('~Go to menu.').click();
};
