/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2026 Aleph1-9012
 * Portions derived from GNU GRUB, Copyright 2008, 2009 Free Software Foundation, Inc.
 * Sidonia menu viewer. Uses GNU GRUB 2.14's list layout and viewer interface.
 * The stock viewer remains available for other themes and unsupported layouts.
 */
#include <grub/dl.h>
#include <grub/command.h>
#include <grub/charset.h>
#include <grub/env.h>
#include <grub/menu.h>
#include <grub/menu_viewer.h>
#include <grub/term.h>
#include <grub/time.h>
#include "list-2.14.h"

GRUB_MOD_LICENSE ("GPLv3+");

#define MAX_LISTS 3
#define DURATION 100
#define FRAME_INTERVAL 16

struct layer {
  list_impl_t list;
  struct grub_gui_component_ops ops;
  struct grub_gui_component_ops *original;
  int kind; /* 0: ordinary list, 1: labels, 2: status, 3: card fills. */
  struct grub_font_glyph *glyph[4], *selected_glyph[4];
  int solid[4];
};
struct input {
  struct input *next;
  grub_term_input_t term;
  int (*getkey) (grub_term_input_t);
};
static struct layer layers[MAX_LISTS];
static int layer_count, invalid, echelon, active, animating;
static struct input *inputs;
static grub_gfxmenu_view_t view;
static struct grub_gfxmenu_timeout_notify *own_notifications, *previous_notifications;
static int owns_notifications;
static grub_err_t (*previous_hook) (int, grub_menu_t, int);
static grub_command_t command;
static char *active_theme;
static grub_video_rect_t current, origin, destination;
static grub_uint64_t started, next_frame;
static unsigned changes, unchanged, frames, redraw_ms, max_redraw_ms;
static int booting;
static grub_term_output_t boot_term;
static void (*boot_cls) (grub_term_output_t);

static void
show_boot_status (grub_term_output_t term)
{
  grub_term_setcolorstate (term, GRUB_TERM_COLOR_STANDARD);
  grub_puts_terminal ("Booting...\n\n", term);
  grub_term_refresh (term);
}

static void
boot_clear (grub_term_output_t term)
{
  /* normal/menu.c clears the terminal after the viewer closes on manual
   * boot. Reprint once after that clear, then restore the normal callback. */
  term->cls = boot_cls;
  boot_term = 0;
  term->cls (term);
  show_boot_status (term);
}

static int
intersect (grub_video_rect_t *out, const grub_video_rect_t *a,
           const grub_video_rect_t *b)
{
  int x = grub_max (a->x, b->x), y = grub_max (a->y, b->y);
  int right = grub_min (a->x + (int) a->width, b->x + (int) b->width);
  int bottom = grub_min (a->y + (int) a->height, b->y + (int) b->height);
  out->x = x; out->y = y;
  out->width = grub_max (0, right - x); out->height = grub_max (0, bottom - y);
  return out->width && out->height;
}

static grub_video_rect_t
unite (grub_video_rect_t a, grub_video_rect_t b)
{
  int right = grub_max (a.x + a.width, b.x + b.width);
  int bottom = grub_max (a.y + a.height, b.y + b.height);
  a.x = grub_min (a.x, b.x); a.y = grub_min (a.y, b.y);
  a.width = right - a.x; a.height = bottom - a.y;
  return a;
}

static int
shown (list_impl_t s)
{
  grub_gfxmenu_box_t b = s->menu_box, n = s->item_box, h = s->selected_item_box;
  int pad = grub_max (n->get_top_pad (n), h->get_top_pad (h))
          + grub_max (n->get_bottom_pad (n), h->get_bottom_pad (h));
  return (s->bounds.height + s->item_spacing - 2 * s->item_padding - pad
          - b->get_top_pad (b) - b->get_bottom_pad (b))
         / (s->item_height + s->item_spacing);
}

static grub_video_rect_t
glyph_rect (struct layer *l, int index, int selected)
{
  list_impl_t s = l->list;
  struct grub_font_glyph *g = selected ? l->selected_glyph[index] : l->glyph[index];
  grub_font_t f = selected ? s->selected_item_font : s->item_font;
  int baseline = (s->item_height - grub_font_get_ascent (f)
                  - grub_font_get_descent (f)) / 2 + grub_font_get_ascent (f);
  grub_video_rect_t r = { s->bounds.x + g->offset_x,
    s->bounds.y + index * (s->item_height + s->item_spacing)
      + baseline - g->offset_y - g->height, g->width, g->height };
  return r;
}

static grub_video_rect_t
row_rect (list_impl_t s, int index)
{
  grub_gfxmenu_box_t b = s->menu_box, h = s->selected_item_box, n = s->item_box;
  grub_video_rect_t r;
  r.x = s->bounds.x + b->get_left_pad (b) + s->item_padding;
  r.y = s->bounds.y + b->get_top_pad (b) + s->item_padding
        + (index - s->first_shown_index) * (s->item_height + s->item_spacing)
        + grub_max (n->get_top_pad (n), h->get_top_pad (h)) - h->get_top_pad (h);
  r.width = s->bounds.width - b->get_left_pad (b) - b->get_right_pad (b)
            - 2 * s->item_padding;
  r.height = s->item_height + h->get_top_pad (h) + h->get_bottom_pad (h);
  return r;
}

static grub_video_rect_t
selection_rect (int index)
{
  int i;
  for (i = 0; i < layer_count; i++)
    if (layers[i].kind == 3) return glyph_rect (&layers[i], index, 0);
  return row_rect (layers[0].list, index);
}

static void
set_clip (const grub_video_rect_t *r)
{
  grub_video_set_area_status (GRUB_VIDEO_AREA_ENABLED);
  grub_video_set_region (r->x, r->y, r->width, r->height);
}

/* Echelon titles carry one private-use glyph containing the prepared label.
 * Cache those glyph pointers once, and skip entries outside the dirty region.
 * Solid shape glyphs use fill_rect instead of scanning identical bits on
 * every keypress. Glyphs with clipped corner pixels retain their exact mask.
 */
static void
paint_cards (struct layer *l, const grub_video_rect_t *region)
{
  int i;
  list_impl_t s = l->list;
  grub_video_rect_t clip;
  for (i = 0; i < view->menu->size; i++)
    {
      int selected = (l->kind == 2 || !animating) && i == view->selected;
      struct grub_font_glyph *g = selected ? l->selected_glyph[i] : l->glyph[i];
      grub_video_rect_t r = glyph_rect (l, i, selected);
      grub_video_color_t color = grub_video_map_rgba_color (
        selected ? s->selected_item_color : s->item_color);
      if (!intersect (&clip, &r, region)) continue;
      if (l->kind == 3 && l->solid[i])
        grub_video_fill_rect (color, r.x, r.y, r.width, r.height);
      else
        grub_font_draw_glyph (g, color, r.x - g->offset_x,
                              r.y + g->height + g->offset_y);
      if (l->kind == 1 && animating && intersect (&clip, &clip, &current))
        {
          set_clip (&clip);
          grub_font_draw_glyph (g, grub_video_map_rgba_color (s->selected_item_color),
                                r.x - g->offset_x, r.y + g->height + g->offset_y);
          set_clip (region);
        }
    }
  if (l->kind == 3 && animating && intersect (&clip, &current, region))
    grub_video_fill_rect (grub_video_map_rgba_color (s->selected_item_color),
                          clip.x, clip.y, clip.width, clip.height);
}

/* During a glide, retain the stock list's decorations and scrollbar. Paint the
 * selector at its current position, then recolor only the text it covers.
 * At rest the stock painter is used, preserving its exact settled appearance.
 */
static void
paint_list (void *self, const grub_video_rect_t *region)
{
  int i, saved;
  struct layer *l = 0;
  list_impl_t s = self;
  grub_video_rect_t clip, text, old_clip, viewport;
  for (i = 0; i < layer_count; i++) if (layers[i].list == s) l = &layers[i];
  if (!l || !s->visible || !grub_video_have_common_points (region, &s->bounds)) return;
  grub_video_get_region (&old_clip.x, &old_clip.y, &old_clip.width, &old_clip.height);
  grub_video_get_viewport (&viewport.x, &viewport.y, &viewport.width, &viewport.height);
  if (l->kind)
    {
      if (intersect (&clip, region, &s->bounds))
        { set_clip (&clip); paint_cards (l, &clip); }
    }
  else if (!animating)
    l->original->paint (self, region);
  else
    {
      grub_gfxmenu_box_t box = s->selected_item_box, normal = s->item_box;
      saved = view->selected; view->selected = -1;
      l->original->paint (self, region);
      view->selected = saved;
      if (intersect (&clip, region, &s->bounds))
        {
          int left = grub_max (box->get_left_pad (box), normal->get_left_pad (normal));
          int top = grub_max (box->get_top_pad (box), normal->get_top_pad (normal));
          int ascent = grub_font_get_ascent (s->item_font);
          int baseline = (s->item_height - ascent - grub_font_get_descent (s->item_font)) / 2 + ascent;
          set_clip (&clip);
          box->set_content_size (box, current.width - box->get_left_pad (box)
                                  - box->get_right_pad (box), s->item_height);
          box->draw (box, current.x, current.y);
          for (i = s->first_shown_index;
               i < s->first_shown_index + shown (s) && i < view->menu->size; i++)
            {
              grub_video_rect_t row = row_rect (s, i), covered;
              text.x = row.x + left + s->item_icon_space;
              text.y = row.y - top + box->get_top_pad (box) + normal->get_top_pad (normal);
              text.width = row.width - left - s->item_icon_space - normal->get_right_pad (normal);
              text.height = s->item_height;
              if (intersect (&covered, &text, &current) && intersect (&covered, &covered, &clip))
                {
                  set_clip (&covered);
                  grub_font_draw_string (grub_menu_get_entry (view->menu, i)->title,
                    s->item_font, grub_video_map_rgba_color (s->selected_item_color),
                    text.x, text.y + baseline);
                }
            }
        }
    }
  grub_video_set_viewport (viewport.x, viewport.y, viewport.width, viewport.height);
  set_clip (&old_clip);
}

static void
redraw (grub_video_rect_t region)
{
  grub_video_rect_t clipped;
  if (!intersect (&clipped, &region, &view->screen)) return;
  set_clip (&clipped);
  grub_gfxmenu_view_redraw (view, &clipped);
}

static void
present (grub_video_rect_t region, int old_entry, int new_entry)
{
  int pass, i;
  grub_uint64_t before = grub_get_time_ms ();
  for (pass = 0; pass <= view->double_repaint; pass++)
    {
      redraw (region);
      /* Status labels occupy a separate, narrow column in Echelon. */
      if (echelon && old_entry >= 0)
        for (i = 0; i < layer_count; i++) if (layers[i].kind == 2)
          {
            redraw (unite (glyph_rect (&layers[i], old_entry, 0),
                           glyph_rect (&layers[i], old_entry, 1)));
            redraw (unite (glyph_rect (&layers[i], new_entry, 0),
                           glyph_rect (&layers[i], new_entry, 1)));
          }
      if (!pass) grub_video_swap_buffers ();
    }
  unsigned cost = grub_get_time_ms () - before;
  frames++; redraw_ms += cost; max_redraw_ms = grub_max (max_redraw_ms, cost);
}

/* Use GRUB's division helper: i386 GRUB does not export GCC's __divdi3. */
static int
interpolate (int from, int to, unsigned factor)
{
  int distance = to - from;
  unsigned offset = grub_divmod64 ((grub_uint64_t) (distance < 0 ? -distance : distance)
                                  * factor, 1000000, 0);
  return from + (distance < 0 ? -(int) offset : (int) offset);
}

static void
tick (void)
{
  grub_uint64_t now;
  grub_video_rect_t old;
  unsigned elapsed, factor;
  if (!active || !animating) return;
  now = grub_get_time_ms ();
  if (now < next_frame) return;
  old = current;
  elapsed = grub_min (now - started, DURATION);
  /* Cubic ease-out in fixed point. Never wait here for the next frame. */
  factor = 1000000 - (100 - elapsed) * (100 - elapsed) * (100 - elapsed);
#define LERP(member) current.member = interpolate (origin.member, destination.member, factor)
  LERP (x); LERP (y); LERP (width); LERP (height);
#undef LERP
  if (elapsed == DURATION) { animating = 0; current = destination; }
  present (unite (old, current), -1, -1);
  next_frame = grub_get_time_ms () + FRAME_INTERVAL;
}

static int
getkey (grub_term_input_t term)
{
  struct input *in;
  int key = GRUB_TERM_NO_KEY;
  for (in = inputs; in; in = in->next)
    if (in->term == term) { key = in->getkey (term); break; }
  if (key > 0)
    {
      grub_menu_entry_t entry = 0;
      if (key == '\n' || key == '\r' || key == GRUB_TERM_KEY_RIGHT
          || key == (GRUB_TERM_CTRL | 'f'))
        entry = grub_menu_get_entry (view->menu, view->selected);
      else if (key != 'c' && key != 'e' && key != GRUB_TERM_ESC
               && key != (GRUB_TERM_CTRL | 'l'))
        for (entry = view->menu->entry_list; entry; entry = entry->next)
          if (entry->hotkey == key) break;
      booting = entry && !entry->submenu;
    }
  /* Poll every input before rendering a frame. Enter and direction changes
   * never wait for an animation to finish or get queued behind old targets. */
  if (key == GRUB_TERM_NO_KEY && in && !in->next) tick ();
  return key;
}

static void
finish (void)
{
  active = animating = 0;
  if (boot_term)
    {
      if (boot_term->cls == boot_clear) boot_term->cls = boot_cls;
      boot_term = 0;
    }
  while (inputs)
    {
      struct input *in = inputs; inputs = in->next;
      if (in->term->getkey == getkey) in->term->getkey = in->getkey;
      grub_free (in);
    }
  if (owns_notifications)
    {
      own_notifications = grub_gfxmenu_timeout_notifications;
      grub_gfxmenu_timeout_notifications = previous_notifications;
      owns_notifications = 0;
    }
}

static void
close_view (void *data)
{
  grub_gfxmenu_view_t closing = data;
  grub_term_output_t term;
  finish ();
  /* The stock viewer leaves gfxterm inside the theme's terminal rectangle.
   * Restore the full screen before native entry commands or authentication
   * print anything. This also covers timeout and hotkey boots. On return,
   * view_draw restores the themed terminal and its decoration normally. */
  FOR_ACTIVE_TERM_OUTPUTS (term)
    if (term->fullscreen && !grub_strcmp (term->name, "gfxterm"))
      {
        grub_video_set_active_render_target (GRUB_VIDEO_RENDER_TARGET_DISPLAY);
        grub_video_set_viewport (0, 0, closing->screen.width, closing->screen.height);
        set_clip (&closing->screen);
        if (term->fullscreen () == GRUB_ERR_NONE)
          {
            if (booting)
              {
                if (term->cls)
                  { boot_term = term; boot_cls = term->cls; term->cls = boot_clear; }
                show_boot_status (term);
              }
            else grub_term_refresh (term);
          }
        break;
      }
}

static void
chosen (int entry, void *data __attribute__ ((unused)))
{
  int old_entry = view->selected, i, scrolled = 0;
  grub_video_rect_t old = current, area;
  if (entry == old_entry) { unchanged++; return; }
  if (entry < 0 || entry >= view->menu->size) return;
  changes++;
  view->selected = entry;
  for (i = 0; i < layer_count; i++)
    {
      list_impl_t s = layers[i].list;
      int first = s->first_shown_index, count = shown (s);
      if (entry < first) s->first_shown_index = entry;
      else if (entry >= first + count) s->first_shown_index = entry - count + 1;
      if (first != s->first_shown_index) scrolled = 1;
    }
  destination = selection_rect (entry);
  if (scrolled)
    {
      animating = 0; current = destination;
      area = layers[0].list->bounds;
      for (i = 1; i < layer_count; i++) area = unite (area, layers[i].list->bounds);
      present (area, old_entry, entry);
      return;
    }
  origin = current; animating = inputs != 0;
  started = grub_get_time_ms (); next_frame = started;
  if (!animating) current = destination;
  /* Update logical selection immediately; subsequent idle polls move it. */
  present (unite (old, current), old_entry, entry);
}

static void
collect (grub_gui_component_t component, void *unused __attribute__ ((unused)))
{
  list_impl_t s;
  struct layer *l;
  const char *name;
  int i;
  if (!component->ops->is_instance (component, "list")) return;
  if (layer_count == MAX_LISTS) { invalid = 1; return; }
  s = (list_impl_t) component;
  if (s->icon_width || s->icon_height || !s->menu_box || !s->item_box
      || !s->selected_item_box || s->item_height + s->item_spacing <= 0
      || s->item_font != s->selected_item_font || s->bounds.width > 8192
      || s->bounds.height > 8192 || shown (s) <= 0)
    {
      /* Echelon's status layer deliberately uses two fonts. */
      if (!echelon || s->icon_width || s->icon_height || !s->menu_box
          || !s->item_box || !s->selected_item_box || s->item_height + s->item_spacing != 1)
        { invalid = 1; return; }
    }
  l = &layers[layer_count++]; grub_memset (l, 0, sizeof (*l));
  l->list = s; l->original = component->ops; l->ops = *component->ops;
  l->ops.paint = paint_list;
  if (!echelon) return;
  name = grub_font_get_name (s->item_font);
  /* Installed Echelon fonts include their content generation in the name. */
  if (grub_strncmp (name, "Cascade ", 8)) { invalid = 1; return; }
  if (grub_strstr (name, " labels 16")) l->kind = 1;
  else if (grub_strstr (name, " status 16")) l->kind = 2;
  else if (grub_strstr (name, " shapes 16")) l->kind = 3;
  else { invalid = 1; return; }
  if (view->menu->size < 1 || view->menu->size > 4) { invalid = 1; return; }
  for (i = 0; i < view->menu->size; i++)
    {
      grub_uint32_t code;
      const unsigned char *title = (void *) grub_menu_get_entry (view->menu, i)->title;
      if (grub_utf8_to_ucs4 (&code, 1, title, -1, 0) != 1 || code != 0xe000U + i)
        { invalid = 1; return; }
      l->glyph[i] = grub_font_get_glyph (s->item_font, code);
      l->selected_glyph[i] = grub_font_get_glyph (s->selected_item_font, code);
      if (!l->glyph[i] || !l->selected_glyph[i]) { invalid = 1; return; }
      if (l->kind == 3)
        {
          struct grub_font_glyph *g = l->glyph[i];
          unsigned bits = g->width * g->height, byte;
          l->solid[i] = 1;
          for (byte = 0; byte < bits / 8; byte++)
            if (g->bitmap[byte] != 0xff)
              { l->solid[i] = 0; break; }
          if (bits % 8)
            {
              unsigned mask = (0xff << (8 - bits % 8)) & 0xff;
              if ((g->bitmap[bits / 8] & mask) != mask) l->solid[i] = 0;
            }
        }
    }
}

static void
restore_lists (void)
{
  int i;
  for (i = 0; i < layer_count; i++)
    layers[i].list->list.component.ops = layers[i].original;
  layer_count = 0;
}

static grub_err_t
try_view (int entry, grub_menu_t menu, int nested)
{
  const char *theme = grub_env_get ("theme");
  struct grub_video_mode_info mode;
  struct grub_menu_viewer *viewer;
  grub_term_input_t term;
  struct input **tail = &inputs;
  int i;
  finish ();
  if (!theme || !active_theme || grub_strcmp (theme, active_theme))
    return previous_hook ? previous_hook (entry, menu, nested) : GRUB_ERR_BAD_ARGUMENT;
  if (grub_video_get_info (&mode)) return grub_errno;
  viewer = grub_zalloc (sizeof (*viewer));
  if (!viewer) return grub_errno;
  restore_lists ();
  /* A submenu may have replaced the global timeout notification list.
   * Keep each viewer's notifications with its canvas. Creating or destroying
   * our view must not free the stock viewer's cached notification list. */
  previous_notifications = grub_gfxmenu_timeout_notifications;
  grub_gfxmenu_timeout_notifications = own_notifications;
  own_notifications = 0;
  if (view && (grub_strcmp (view->theme_path, theme)
               || view->screen.width != mode.width || view->screen.height != mode.height))
    { grub_gfxmenu_view_destroy (view); view = 0; }
  if (!view) view = grub_gfxmenu_view_new (theme, mode.width, mode.height);
  if (!view)
    {
      grub_gfxmenu_timeout_notifications = previous_notifications;
      grub_free (viewer); return grub_errno;
    }
  owns_notifications = 1;
  view->double_repaint = (mode.mode_type & GRUB_VIDEO_MODE_TYPE_DOUBLE_BUFFERED)
                         && !(mode.mode_type & GRUB_VIDEO_MODE_TYPE_UPDATING_SWAP);
  view->selected = entry; view->menu = menu; view->nested = nested; view->first_timeout = -1;
  grub_menu_entry_t selected = grub_menu_get_entry (menu, entry);
  booting = selected && !selected->submenu; /* Default entry on timer expiry. */
  grub_video_set_viewport (0, 0, mode.width, mode.height);
  if (view->double_repaint) { grub_video_swap_buffers (); grub_video_set_viewport (0, 0, mode.width, mode.height); }
  grub_gfxmenu_view_draw (view);
  invalid = 0;
  grub_gui_iterate_recursively ((grub_gui_component_t) view->canvas, collect, 0);
  if (invalid || layer_count != (echelon ? 3 : 1))
    {
      grub_env_set ("sidonia_renderer", "stock");
      restore_lists ();
      viewer->set_chosen_entry = grub_gfxmenu_set_chosen_entry;
    }
  else
    {
      for (i = 0; i < layer_count; i++) layers[i].list->list.component.ops = &layers[i].ops;
      current = destination = selection_rect (entry);
      viewer->set_chosen_entry = chosen;
      active = 1;
      grub_env_set ("sidonia_renderer", "motion");
    }
  FOR_ACTIVE_TERM_INPUTS (term)
    {
      struct input *in = grub_malloc (sizeof (*in));
      if (!in) { finish (); booting = 0; grub_errno = GRUB_ERR_NONE; break; }
      in->term = term; in->getkey = term->getkey; in->next = 0;
      *tail = in; tail = &in->next;
    }
  for (struct input *in = inputs; in; in = in->next) in->term->getkey = getkey;
  viewer->data = view; viewer->fini = close_view;
  viewer->print_timeout = grub_gfxmenu_print_timeout;
  viewer->clear_timeout = grub_gfxmenu_clear_timeout;
  grub_menu_register_viewer (viewer);
  return GRUB_ERR_NONE;
}

static grub_err_t
configure (grub_command_t cmd __attribute__ ((unused)), int argc, char **argv)
{
  const char *theme = grub_env_get ("theme");
  char *copy;
  if (argc == 1 && !grub_strcmp (argv[0], "status"))
    {
      grub_printf ("Sidonia renderer=%s changes=%u unchanged=%u frames=%u redraw_ms=%u max_redraw_ms=%u\n",
                   grub_env_get ("sidonia_renderer") ? : "inactive", changes, unchanged,
                   frames, redraw_ms, max_redraw_ms);
      return GRUB_ERR_NONE;
    }
  if (argc != 1 || !theme || (grub_strcmp (argv[0], "list") && grub_strcmp (argv[0], "echelon")))
    return GRUB_ERR_BAD_ARGUMENT;
  copy = grub_strdup (theme);
  if (!copy) return grub_errno;
  grub_free (active_theme); active_theme = copy;
  echelon = !grub_strcmp (argv[0], "echelon");
  grub_gfxmenu_try_hook = try_view;
  return GRUB_ERR_NONE;
}

GRUB_MOD_INIT (sidonia_motion)
{
  previous_hook = grub_gfxmenu_try_hook;
  command = grub_register_command ("sidonia_motion", configure, "list|echelon|status", "Enable Sidonia menu motion or show timings.");
  grub_dl_ref (mod);
}

GRUB_MOD_FINI (sidonia_motion)
{
  struct grub_gfxmenu_timeout_notify *saved;
  finish (); restore_lists ();
  if (grub_gfxmenu_try_hook == try_view) grub_gfxmenu_try_hook = previous_hook;
  saved = grub_gfxmenu_timeout_notifications;
  grub_gfxmenu_timeout_notifications = own_notifications;
  grub_gfxmenu_view_destroy (view);
  grub_gfxmenu_timeout_notifications = saved;
  grub_free (active_theme);
  grub_unregister_command (command);
}
