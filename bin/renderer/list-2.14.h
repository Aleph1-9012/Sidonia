/* gui_list.c - GUI component to display a selectable list of items.  */
/*
 *  GRUB  --  GRand Unified Bootloader
 *  Copyright (C) 2008,2009  Free Software Foundation, Inc.
 *
 *  GRUB is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  GRUB is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with GRUB.  If not, see <http://www.gnu.org/licenses/>.
 */

#include <grub/mm.h>
#include <grub/misc.h>
#include <grub/gui.h>
#include <grub/gui_string_util.h>
#include <grub/gfxmenu_view.h>
#include <grub/gfxwidgets.h>
#include <grub/color.h>

enum scrollbar_slice_mode {
  SCROLLBAR_SLICE_WEST,
  SCROLLBAR_SLICE_CENTER,
  SCROLLBAR_SLICE_EAST
};

struct grub_gui_list_impl
{
  struct grub_gui_list list;

  grub_gui_container_t parent;
  grub_video_rect_t bounds;
  char *id;
  int visible;

  int icon_width;
  int icon_height;
  int item_height;
  int item_padding;
  int item_icon_space;
  int item_spacing;
  grub_font_t item_font;
  int selected_item_font_inherit;
  grub_font_t selected_item_font;
  grub_video_rgba_color_t item_color;
  int selected_item_color_inherit;
  grub_video_rgba_color_t selected_item_color;

  int draw_scrollbar;
  int need_to_recreate_scrollbar;
  char *scrollbar_frame_pattern;
  char *scrollbar_thumb_pattern;
  grub_gfxmenu_box_t scrollbar_frame;
  grub_gfxmenu_box_t scrollbar_thumb;
  int scrollbar_thumb_overlay;
  int scrollbar_width;
  enum scrollbar_slice_mode scrollbar_slice;
  int scrollbar_left_pad;
  int scrollbar_right_pad;
  int scrollbar_top_pad;
  int scrollbar_bottom_pad;

  int first_shown_index;

  int need_to_recreate_boxes;
  char *theme_dir;
  char *menu_box_pattern;
  char *item_box_pattern;
  int selected_item_box_pattern_inherit;
  char *selected_item_box_pattern;
  grub_gfxmenu_box_t menu_box;
  grub_gfxmenu_box_t selected_item_box;
  grub_gfxmenu_box_t item_box;

  grub_gfxmenu_icon_manager_t icon_manager;

  grub_gfxmenu_view_t view;
};

typedef struct grub_gui_list_impl *list_impl_t;

/* Private list layout from GNU GRUB 2.14. Enable only with that ABI. */
