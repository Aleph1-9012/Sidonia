#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Aleph1-9012

set -Eeuo pipefail

if test "${EUID:-$(id -u)}" -ne 0; then
    echo "Run the installer with sudo:" >&2
    echo "  sudo ./install.sh" >&2
    exit 1
fi

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_THEMES="$REPO_ROOT/themes"
SOURCE_COMMAND="$REPO_ROOT/bin/sidonia"
INSTALL_ROOT="${SIDONIA_INSTALL_ROOT:-/usr/local/share/sidonia}"
COMMAND_PATH="${SIDONIA_COMMAND_PATH:-/usr/local/bin/sidonia}"
LEGACY_COMMAND_PATH="${SIDONIA_LEGACY_COMMAND_PATH:-$(dirname "$COMMAND_PATH")/sidonia-theme}"
STAGE=""
OLD_INSTALL=""
SUCCESS=0

usage() {
    cat <<'EOF'
Usage:
  sudo ./install.sh
  sudo ./install.sh THEME PROFILE [--gfxmode WIDTHxHEIGHT]
  sudo ./install.sh --no-apply

Examples:
  sudo ./install.sh T4 1440p
  sudo ./install.sh T2 1080p
EOF
}

# Keep the GRUB runtime in this installer. Quoted delimiters preserve its code
# verbatim; the installed files are also used by later grub-mkconfig runs.
write_runtime() {
    local RUNTIME_DEST="$1"

    cat > "$RUNTIME_DEST/cascade/runtime.sh" <<'SIDONIA_ECHELON_RUNTIME'
#!/usr/bin/env bash
# Assemble Echelon from release assets and literal native GRUB entries.
set -Eeuo pipefail
export LC_ALL=C

RUNTIME=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
THEME=$(cd -- "${1:?Theme directory is required}" && pwd)
shift
MODE="" CONFIG=""
while (($#)); do
    case "$1" in
        --mode) MODE=${2:?Graphics mode is required}; shift 2 ;;
        --config) CONFIG=${2:?Configuration file is required}; shift 2 ;;
        *) printf 'Echelon: unknown argument: %s\n' "$1" >&2; exit 1 ;;
    esac
done
[[ "$MODE" =~ ^[0-9]+x[0-9]+$ ]] || { echo 'Echelon: one numeric graphics mode is required' >&2; exit 1; }
[[ "${THEME##*/}" =~ ^Sidonia-T5-(720p|1080p|1440p)$ ]] || { echo 'Echelon: invalid installed theme directory' >&2; exit 1; }
IFS=x read -r WIDTH HEIGHT < "$THEME/framebuffer"
case "$WIDTH"x"$HEIGHT" in
    1280x720|1920x1080|2560x1440) ;;
    *) echo 'Echelon: unsupported canvas' >&2; exit 1 ;;
esac
PLAIN_FONT=plain.pf2
[[ "$WIDTH" == 1920 ]] && PLAIN_FONT=ui.pf2
if [[ -z "$CONFIG" ]]; then
    [[ -f /proc/self/fd/1 ]] || { echo 'Echelon requires grub-mkconfig -o FILE' >&2; exit 1; }
    CONFIG=/proc/self/fd/1
fi
umask 077
mkdir -p -- "$THEME/generated"
ECHELON_WORK=$(mktemp -d "$THEME/generated/.echelon.XXXXXX")
trap 'rm -rf -- "$ECHELON_WORK"' EXIT
export ECHELON_WORK
# Copy before emitting anything, since stdout can be this same configuration.
exec {CONFIG_FD}< "$CONFIG"
cat <&"$CONFIG_FD" > "$ECHELON_WORK/input.cfg"
exec {CONFIG_FD}<&-

cat <<EOF
# Echelon entries assembled from the current GRUB configuration.
set sidonia_base_dir="\$prefix/themes/${THEME##*/}"
export sidonia_base_dir
function sidonia_plain_menu {
  terminal_output console
  unset theme
  set gfxmode=auto
  if loadfont "\$sidonia_base_dir/fonts/$PLAIN_FONT"; then
    set gfxterm_font='Cascade UI 18'
  else
    loadfont "\$prefix/fonts/unicode.pf2"
    set gfxterm_font='Unifont Regular 16'
  fi
  if terminal_output gfxterm; then true; else terminal_output console; fi
}
EOF
fallback() {
    printf '%s\n' '# Echelon used the complete original menu.' 'sidonia_plain_menu'
}
if [[ -f "$THEME/../../custom.cfg" ]]; then fallback; exit; fi
if ! awk -f "$RUNTIME/menu.awk" "$ECHELON_WORK/input.cfg"; then fallback; exit; fi
COUNT=$(cat "$ECHELON_WORK/count")
ECHELON_VARIANT=$THEME
[[ "$COUNT" == 4 ]] || ECHELON_VARIANT="$THEME/variants/$COUNT"
ECHELON_GENERATION=$(
    cat -- "$ECHELON_WORK/native.cfg" "$THEME/SHA256SUMS" \
        "$RUNTIME/runtime.sh" "$RUNTIME/menu.awk" "$RUNTIME/labels.awk" | sha256sum
)
ECHELON_GENERATION=${ECHELON_GENERATION:0:20}
TARGET="$THEME/generated/$ECHELON_GENERATION"
ECHELON_READY="$ECHELON_WORK/ready"
export ECHELON_VARIANT ECHELON_GENERATION ECHELON_READY
if [[ -d "$TARGET" ]]; then
    (cd -- "$TARGET" && sha256sum --quiet -c SHA256SUMS) >&2
else
    mkdir -- "$ECHELON_READY"
    cp -- "$ECHELON_VARIANT/background.png" "$ECHELON_VARIANT/foreground.png" "$ECHELON_READY/"
    # Only the four entry fonts have a generation-specific name. Timer fonts
    # remain prebuilt because their content never depends on boot entries.
    sed -E "s/Cascade library (labels|shapes|status|status-selected) /Cascade $ECHELON_GENERATION \1 /g" \
        "$ECHELON_VARIANT/theme.txt" > "$ECHELON_READY/theme.txt"
    cp -- "$THEME"/timer-*.pf2 "$ECHELON_READY/"
    cp -- "$THEME/fonts/ui.pf2" "$ECHELON_READY/ui.pf2"
    # Decompress completely before awk, so a damaged library cannot be mistaken
    # for a supported title with only some of its character data present.
    gzip -cd -- "$THEME/characters.gz" > "$ECHELON_WORK/characters"
    if ! awk -f "$RUNTIME/labels.awk" "$ECHELON_WORK/characters"; then fallback; exit; fi
    UI_SIZE=$((36*WIDTH/3840))
    ((UI_SIZE>=14)) || UI_SIZE=14
    {
        cat <<'EOF'
function sidonia_graphics {
  terminal_output console
  insmod all_video
  insmod gfxterm
  insmod gfxmenu
  insmod png
  set sidonia_font_error=0
EOF
        for FONT in labels shapes status status-selected timer-detail timer-fill timer-ink ui; do
            printf '  if loadfont "$sidonia_theme_dir/%s.pf2"; then true; else set sidonia_font_error=1; fi\n' "$FONT"
        done
        cat <<EOF
  set gfxterm_font='Cascade UI $UI_SIZE'
  export gfxterm_font
  set gfxmode=\$sidonia_gfxmode,sidonia_no_auto_fallback
  export gfxmode
  set theme="\$sidonia_theme_dir/theme.txt"
  export theme
  if [ "\$sidonia_font_error" = 0 ]; then terminal_output gfxterm; else false; fi
}
EOF
        cat <<'EOF'
set default="$sidonia_system_default"
set config_directory="$sidonia_native_config_directory"
set config_file="$sidonia_native_config_file"
set timeout_style=menu
set timeout=6
if [ "$sidonia_original_timeout" = -1 ]; then set timeout=-1; fi
if [ "$sidonia_original_timeout" = 0 ]; then set timeout=0; fi
EOF
        cat -- "$ECHELON_WORK/remaps.cfg"
        printf '\nif sidonia_graphics; then\n'
        cat -- "$ECHELON_WORK/body.cfg"
        cat <<'EOF'
else
  set sidonia_original_menu=1
  export sidonia_original_menu
  configfile "$prefix/grub.cfg"
fi
EOF
    } > "$ECHELON_READY/menu.cfg"
    CHECK=${SIDONIA_GRUB_SCRIPT_CHECK:-}
    if [[ -z "$CHECK" ]]; then
        CHECK=$(command -v grub-script-check || command -v grub2-script-check)
    fi
    "$CHECK" "$ECHELON_READY/menu.cfg" >&2
    (cd -- "$ECHELON_READY" && sha256sum ./*.pf2 ./*.png menu.cfg theme.txt > SHA256SUMS)
    mv -- "$ECHELON_READY" "$TARGET"
fi
cat <<EOF
set sidonia_gfxmode=$MODE
export sidonia_gfxmode
set sidonia_theme_dir="\$sidonia_base_dir/generated/$ECHELON_GENERATION"
export sidonia_theme_dir
EOF
cat <<'EOF'
if [ "$sidonia_original_menu" = 1 ]; then
  sidonia_plain_menu
  set timeout_style=menu
  set timeout=-1
else
EOF
sort -u -- "$ECHELON_WORK/exports.cfg"
cat <<'EOF'
  set sidonia_native_config_directory="$config_directory"
  export sidonia_native_config_directory
  set sidonia_native_config_file="$config_file"
  export sidonia_native_config_file
  set sidonia_system_default="$default"
  export sidonia_system_default
  set sidonia_original_timeout="$timeout"
  export sidonia_original_timeout
  configfile "$sidonia_theme_dir/menu.cfg"
  sidonia_plain_menu
  set timeout_style=menu
  set timeout=-1
fi
EOF
SIDONIA_ECHELON_RUNTIME

    cat > "$RUNTIME_DEST/cascade/menu.awk" <<'SIDONIA_ECHELON_MENU_AWK'
# Parse literal GRUB entries without executing configuration text.
# Run with LC_ALL=C so offsets refer to bytes, including UTF-8 titles.
function quote(s,    out,i,c) {
    out = "'"
    for (i=1; i<=length(s); i++) {
        c=substr(s,i,1)
        out=out (c == "'" ? "'\\''" : c)
    }
    return out "'"
}
function regex_quote(s,    out,i,c) {
    out=""
    for (i=1;i<=length(s);i++) {
        c=substr(s,i,1)
        if (index("\\.^$*+?()[]{}|",c)) out=out "\\"
        out=out c
    }
    return out
}
function words(s,a,    n,i,c,q,e,w,active) {
    n=0; q=""; e=0; w=""; active=0
    for(i=1;i<=length(s);i++) {
        c=substr(s,i,1)
        if(e) {w=w c; e=0}
        else if(c=="\\" && q!="'") {e=1; active=1}
        else if(q!="") {if(c==q) q=""; else w=w c}
        else if(c=="'" || c=="\"") {q=c; active=1}
        else if(c ~ /[ \t\r\n]/) {if(active) {a[++n]=w; w=""; active=0}}
        else {w=w c; active=1}
    }
    if(active) a[++n]=w
    return n
}
function parse(s,    i,c,q,e,depth,expansion,comment,line,start,t,j,k,pending,nw,token,raw) {
    count=0; q=""; e=0; depth=0; expansion=0; comment=0; line=1; pending=0
    for(i=1;i<=length(s);i++) {
        c=substr(s,i,1)
        if(line && !depth && q=="") {
            raw=substr(s,i)
            if(match(raw,/^[ \t]*(menuentry|submenu)[ \t]+/)) {
                start=i; t=i+RLENGTH
                token=substr(s,t,1)
                if(token!="'" && token!="\"") return -1
                j=t+1
                while(j<=length(s) && substr(s,j,1)!=token) j++
                if(j>length(s)) return -1
                raw=substr(s,t+1,j-t-1)
                if(raw ~ /[$\\[:cntrl:]]/ || substr(s,j+1,1)!~/[ \t\r\n{]/) return -1
                pending=count+1
                title[pending]=raw; first[pending]=start
                ts[pending]=t; te[pending]=j+1
                kind[pending]=(substr(s,i,t-i) ~ /submenu/ ? "submenu" : "menuentry")
                ids[pending]=""
            }
        }
        line=(c=="\n")
        if(comment) {if(line) comment=0; continue}
        if(e) {e=0; continue}
        if(c=="\\" && q!="'") e=1
        else if(q!="") {if(c==q) q=""}
        else if(c=="'" || c=="\"") q=c
        else if(c=="#") comment=1
        else if(c=="{") {
            if(expansion || (i>1 && substr(s,i-1,1)=="$")) expansion++
            else {
                if(!depth && pending) {
                    body[pending]=i+1
                    nw=words(substr(s,first[pending],i-first[pending]),tokens)
                    for(k=1;k<=nw;k++) {
                        if(tokens[k] ~ /^--id=/) ids[pending]=substr(tokens[k],6)
                        else if(tokens[k]=="--id" || tokens[k]=="$menuentry_id_option" || tokens[k]=="${menuentry_id_option}") {
                            if(k<nw) ids[pending]=tokens[k+1]
                        }
                    }
                }
                depth++
            }
        } else if(c=="}") {
            if(expansion) expansion--
            else {
                if(--depth<0) return -1
                if(!depth && pending) {last[pending]=i+1; count=pending; pending=0}
            }
        }
    }
    if(pending || depth || q!="" || expansion || e) return -1
    return count
}
{ source=source $0 "\n" }
END {
    out=ENVIRON["ECHELON_WORK"]
    if(source ~ /(^|\n)[ \t]*blscfg([ \t\r\n]|$)/) exit 2
    n=split(source,lines,"\n"); section=""; native=""; sections=0
    for(i=1;i<=n;i++) {
        if(lines[i] ~ /^### BEGIN .* ###$/) {sections++; section=lines[i] "\n"}
        else if(section!="") section=section lines[i] "\n"
        if(lines[i] ~ /^### END .* ###$/ && section!="") {
            found=parse(section)
            if(found<0) exit 2
            if(found) native=native section "\n"
            section=""
        }
    }
    # grub-mkconfig has already opened this loader's BEGIN section on stdout;
    # only complete earlier sections contain the native boot entries.
    if(!sections) {
        found=parse(source)
        if(found<0) exit 2
        for(i=1;i<=found;i++) native=native substr(source,first[i],last[i]-first[i]) "\n"
    }
    if(parse(native)<1 || count>4) exit 2
    print count > (out "/count")
    printf "%s",native > (out "/native.cfg")
    modified=""; cursor=1
    for(i=1;i<=count;i++) {
        print title[i] > (out "/titles")
        id=(ids[i]!="" ? ids[i] : title[i])
        if(id ~ /[[:cntrl:]]/) exit 2
        # E000..E003, encoded explicitly for every awk implementation.
        marker=sprintf("%c%c%c",238,128,127+i)
        modified=modified substr(native,cursor,ts[i]-cursor) quote(marker " " title[i])
        modified=modified substr(native,te[i],body[i]-1-te[i])
        if(ids[i]=="") modified=modified "--id=" quote(id) " "
        modified=modified "{\n  shift\n  setparams " quote(title[i]) " \"$@\"\n"
        if(kind[i]=="submenu") modified=modified "  unset theme\n"
        cursor=body[i]
        print "if [ \"$default\" = " quote(title[i]) " ]; then set default=" quote(id) "; fi" > (out "/remaps.cfg")
        if(kind[i]=="submenu" && title[i]!=id) {
            t=title[i]; gsub(/>/,">>",t)
            dest=id; gsub(/>/,">>",dest)
            print "if regexp --set=1:sidonia_default_tail " quote("^" regex_quote(t) ">(.*)$") \
                  " \"$default\"; then set default=" quote(dest ">") "\"$sidonia_default_tail\"; fi" > (out "/remaps.cfg")
        }
    }
    printf "%s",modified substr(native,cursor) > (out "/body.cfg")
    rest=source
    while(match(rest,/\$\{?[a-zA-Z_][a-zA-Z_0-9]*/)) {
        t=substr(rest,RSTART,RLENGTH); sub(/^\$\{?/,"",t); exports[t]=1
        rest=substr(rest,RSTART+RLENGTH)
    }
    rest=source
    while(match(rest,/(^|[^a-zA-Z_0-9])set[ \t]+[a-zA-Z_][a-zA-Z_0-9]*[ \t]*=/)) {
        t=substr(rest,RSTART,RLENGTH); sub(/^.*set[ \t]+/,"",t); sub(/[ \t]*=$/,"",t); exports[t]=1
        rest=substr(rest,RSTART+RLENGTH)
    }
    printf "%s","" > (out "/exports.cfg")
    for(t in exports) print "export " t > (out "/exports.cfg")
}
SIDONIA_ECHELON_MENU_AWK

    cat > "$RUNTIME_DEST/cascade/labels.awk" <<'SIDONIA_ECHELON_LABELS_AWK'
# Assemble PF2 label glyphs from the pre-rendered character library.
# All byte I/O uses the C locale. No external commands run from this program.
function fail(message) { print "Echelon: " message > "/dev/stderr"; failed=1; exit 2 }
function byte(n) { return sprintf("%c",n%256) }
function be(n,width,    s,i) {
    if(n<0) n+=65536
    s=""
    for(i=0;i<width;i++) {s=byte(n) s; n=int(n/256)}
    return s
}
function section(tag,s) { return tag be(length(s),4) s }
function number(hex,    i,n) {
    n=0
    for(i=1;i<=length(hex);i++) n=16*n+digits[substr(hex,i,1)]
    return n
}
function decode(s,card,    i,n,j,v,c,b,minimum) {
    j=0
    for(i=1;i<=length(s);i++) {
        c=ord[substr(s,i,1)]
        if(c<128) {v=c; n=0; minimum=0}
        else if(c>=194 && c<=223) {v=c-192; n=1; minimum=128}
        else if(c>=224 && c<=239) {v=c-224; n=2; minimum=2048}
        else if(c>=240 && c<=244) {v=c-240; n=3; minimum=65536}
        else fail("the original menu was kept because a title is not valid UTF-8")
        while(n--) {
            if(++i>length(s)) fail("incomplete UTF-8 title")
            b=ord[substr(s,i,1)]
            if(b<128 || b>191) fail("invalid UTF-8 title")
            v=v*64+b-128
        }
        if(v<minimum || v>1114111 || (v>=55296 && v<=57347) || v<32 || v==127)
            fail("unsupported control or reserved character in a title")
        chars[card,++j]=v; needed[v]=1
    }
    lengths[card]=j
}
function measure(card,size,count,    j,total,key) {
    total=0
    for(j=1;j<=count;j++) {
        key=size SUBSEP chars[card,j]
        if(!(key in advance)) fail("the original menu was kept because a title needs characters outside the bundled fonts")
        total+=advance[key]
    }
    return total
}
function pixels(hex,w,h,x,y,aligned,    p,n,b,k,bit,col,row,stride) {
    if(hex=="-" || !w || !h) return
    stride=(aligned ? int((w+7)/8)*8 : w)
    for(p=1;p<=length(hex);p+=2) {
        n=number(substr(hex,p,2))
        if(!n) continue
        b=int((p-1)/2)*8
        for(k=0;k<8;k++) {
            bit=int(n/powers[7-k])%2
            if(!bit) continue
            row=int((b+k)/stride); col=(b+k)%stride
            if(row>=h || col>=w) continue
            canvas[x+col,y+row]=1
            if(x+col<minx) minx=x+col
            if(x+col>maxx) maxx=x+col
            if(y+row<miny) miny=y+row
            if(y+row>maxy) maxy=y+row
        }
    }
}
function compose(card,    key,cp,w,h,x,y,size,level,count,j,pos,ellipsis,col,row,n,bits,data) {
    for(key in canvas) delete canvas[key]
    cp=57343+card
    minx=gx[cp]; maxx=minx+gw[cp]-1
    miny=ascent+card-1-gh[cp]-gy[cp]; maxy=miny+gh[cp]-1
    pixels(bitmap[cp],gw[cp],gh[cp],minx,miny,0)
    for(level=1;level<=3;level++) {
        size=font_size[card,level]
        if(measure(card,size,lengths[card])<=available[card]*64 || level==3) break
    }
    count=lengths[card]; ellipsis=0
    if(measure(card,size,count)>available[card]*64) {
        ellipsis=3
        while(count && measure(card,size,count)+3*advance[size,46]>available[card]*64) count--
    }
    pos=title_x[card]*64
    for(j=1;j<=count+ellipsis;j++) {
        key=size SUBSEP (j<=count ? chars[card,j] : 46)
        x=int(pos/64+.5)+left[key]; y=title_y[card]+top[key]
        pixels(shape[key],width[key],height[key],x,y,1)
        pos+=advance[key]
    }
    w=maxx-minx+1; h=maxy-miny+1
    data=""; n=0; bits=0
    for(row=miny;row<=maxy;row++) for(col=minx;col<=maxx;col++) {
        n=2*n+((col SUBSEP row) in canvas)
        if(++bits==8) {data=data byte(n); n=0; bits=0}
    }
    if(bits) data=data byte(n*powers[8-bits])
    gw[cp]=w; gh[cp]=h; gx[cp]=minx; gy[cp]=ascent+card-1-miny-h
    bodies[cp]=be(w,2) be(h,2) be(gx[cp],2) be(gy[cp],2) be(0,2) data
}
function write_font(key,    path,line,f,n,cp,i,j,t,name,header,idx,data,offset,maxw,maxh) {
    for(cp in bodies) delete bodies[cp]
    for(cp in gw) delete gw[cp]
    path=ENVIRON["ECHELON_VARIANT"] "/" key ".data"
    while((getline line < path)>0) {
        split(line,f," ")
        if(f[1]=="FONT") {ascent=f[2]+0; descent=f[3]+0; size=f[4]+0}
        else if(f[1]=="G") {
            cp=f[2]+0; gw[cp]=f[3]+0; gh[cp]=f[4]+0; gx[cp]=f[5]+0; gy[cp]=f[6]+0
            bitmap[cp]=f[8]; data=""
            if(f[8]!="-") for(i=1;i<=length(f[8]);i+=2) data=data byte(number(substr(f[8],i,2)))
            bodies[cp]=be(gw[cp],2) be(gh[cp],2) be(gx[cp],2) be(gy[cp],2) be(f[7]+0,2) data
        }
    }
    close(path)
    if(!ascent || !descent || !(57344 in bodies)) fail("invalid prebuilt font template")
    if(key=="labels") for(i=1;i<=cards;i++) compose(i)
    for(cp in needed) if(!(cp in bodies)) {bodies[cp]=be(0,10); gw[cp]=gh[cp]=0}
    n=0; maxw=0; maxh=0
    for(cp in bodies) {
        list[++n]=cp+0
        if(gw[cp]>maxw) maxw=gw[cp]
        if(gh[cp]>maxh) maxh=gh[cp]
    }
    for(i=2;i<=n;i++) {t=list[i]; j=i-1; while(j>0 && list[j]>t) {list[j+1]=list[j]; j--} list[j+1]=t}
    name="Cascade " ENVIRON["ECHELON_GENERATION"] " " key " 16"
    header=section("FILE","PFF2") section("NAME",name) section("FAMI",name) \
           section("WEIG","normal") section("SLAN","normal") section("PTSZ",be(size,2)) \
           section("MAXW",be(maxw,2)) section("MAXH",be(maxh,2)) \
           section("ASCE",be(ascent,2)) section("DESC",be(descent,2))
    offset=length(header)+8+9*n+8; idx=""; data=""
    for(i=1;i<=n;i++) {cp=list[i]; idx=idx be(cp,4) byte(0) be(offset,4); data=data bodies[cp]; offset+=length(bodies[cp])}
    path=ENVIRON["ECHELON_READY"] "/" key ".pf2"
    printf "%s",header section("CHIX",idx) "DATA" be(4294967295,4) data > path
    if(close(path)) fail("could not write a generated font")
}
BEGIN {
    for(i=0;i<256;i++) ord[sprintf("%c",i)]=i
    for(i=0;i<16;i++) digits[substr("0123456789abcdef",i+1,1)]=i
    powers[0]=1; for(i=1;i<=8;i++) powers[i]=powers[i-1]*2
    for(i=32;i<127;i++) needed[i]=1
    path=ENVIRON["ECHELON_WORK"] "/titles"
    while((getline line < path)>0) decode(line,++cards)
    close(path)
    if(cards<1 || cards>4) fail("invalid card count")
}
$1=="CARD" {
    title_x[$2]=$3+0; title_y[$2]=$4+0; available[$2]=$5+0
    for(i=1;i<=3;i++) font_size[$2,i]=$(6+i)+0
}
$1=="G" && ($3 in needed) {
    key=$2 SUBSEP $3
    left[key]=$4+0; top[key]=$5+0; width[key]=$6+0; height[key]=$7+0
    advance[key]=$8+0; shape[key]=$9
}
END {
    if(failed) exit 2
    for(i=1;i<=cards;i++) if(!available[i] || !font_size[i,1]) fail("character library geometry is absent")
    write_font("labels"); write_font("shapes"); write_font("status"); write_font("status-selected")
}
SIDONIA_ECHELON_LABELS_AWK

    cat > "$RUNTIME_DEST/grub.d/99_zz_sidonia" <<'SIDONIA_GRUB_LOADER'
#!/bin/sh
# Sidonia managed late loader v1
# grub-mkconfig exports GRUB_THEME and GRUB_GFXMODE. No output for other themes.
set -eu
themedir=${GRUB_THEME:-}
themedir=${themedir%/theme.txt}
name=${themedir##*/}
case "$name" in
  Sidonia-T[1-5]-720p|Sidonia-T[1-5]-1080p|Sidonia-T[1-5]-1440p) ;;
  *) exit 0 ;;
esac
test -f "$themedir/theme.txt" || exit 0
case "${GRUB_GFXMODE:-}" in
  ''|*[!0-9x]*) echo 'Sidonia requires a single numeric graphics mode' >&2; exit 1 ;;
esac
if test "${name#Sidonia-T5-}" != "$name"; then
  runtime=${SIDONIA_RUNTIME_ROOT:-${SIDONIA_INSTALL_ROOT:-/usr/local/share/sidonia}/lib}
  printf '%s\n' '# Sidonia owns the final theme selection, after other theme loaders.'
  set -- "$themedir" --mode "$GRUB_GFXMODE"
  bash "$runtime/cascade/runtime.sh" "$@"
  exit $?
fi
cat <<EOF
# Sidonia owns the final theme selection, after other theme loaders.
set sidonia_theme_dir="\$prefix/themes/$name"
export sidonia_theme_dir
terminal_output console
unset theme
unset gfxterm_font
insmod all_video
insmod gfxterm
insmod gfxmenu
insmod png
set gfxmode=$GRUB_GFXMODE,sidonia_no_auto_fallback
EOF
for font in "$themedir"/*.pf2 "$themedir"/f/*.pf2 "$themedir"/fonts/*.pf2; do
  test -f "$font" || continue
  relative=${font#"$themedir/"}
  printf 'loadfont "$sidonia_theme_dir/%s"\n' "$relative"
done
cat <<'EOF'
if terminal_output gfxterm; then
  set theme="$sidonia_theme_dir/theme.txt"
  export theme
else
  set gfxmode=auto
  loadfont "$prefix/fonts/unicode.pf2"
  set gfxterm_font='Unifont Regular 16'
  if terminal_output gfxterm; then true; else terminal_output console; fi
fi
EOF
SIDONIA_GRUB_LOADER

    chmod 0644 "$RUNTIME_DEST/cascade/runtime.sh" \
        "$RUNTIME_DEST/cascade/menu.awk" "$RUNTIME_DEST/cascade/labels.awk" \
        "$RUNTIME_DEST/grub.d/99_zz_sidonia"
}

cleanup() {
    local STATUS=$?

    trap - EXIT
    set +e
    test -z "$STAGE" || rm -rf -- "$STAGE"
    if test "$SUCCESS" -ne 1 && test -n "$OLD_INSTALL" && test -d "$OLD_INSTALL"; then
        rm -rf -- "$INSTALL_ROOT"
        mv -- "$OLD_INSTALL" "$INSTALL_ROOT"
    elif test "$SUCCESS" -eq 1 && test -n "$OLD_INSTALL"; then
        rm -rf -- "$OLD_INSTALL"
    fi
    exit "$STATUS"
}
trap cleanup EXIT

test -d "$SOURCE_THEMES" || {
    echo "Theme directory is missing: $SOURCE_THEMES" >&2
    exit 1
}
test -f "$SOURCE_COMMAND" || {
    echo "Theme manager is missing: $SOURCE_COMMAND" >&2
    exit 1
}

if test "${1:-}" = "--help" || test "${1:-}" = "-h"; then
    usage
    exit 0
fi

for THEME in T1 T2 T3 T4 T5; do
    for PROFILE in 720p 1080p 1440p; do
        test -f "$SOURCE_THEMES/$THEME/$PROFILE/theme.txt"
        test -f "$SOURCE_THEMES/$THEME/$PROFILE/background.png"
    done
done

install -d -o root -g root -m 0755 "$(dirname "$INSTALL_ROOT")"
STAGE="$(mktemp -d "$(dirname "$INSTALL_ROOT")/.sidonia.new.XXXXXX")"
umask 022
cp -R --no-preserve=ownership -- "$SOURCE_THEMES" "$STAGE/themes"
install -d -m 0755 "$STAGE/lib/cascade" "$STAGE/lib/grub.d"
# Keep an already-installed legacy renderer for rollback to the old T5 release.
# Fresh installs copy only the shell runtime; the new loader never calls Python.
if test -f "$INSTALL_ROOT/lib/cascade/runtime.py"; then
    cp -R --no-preserve=ownership -- "$INSTALL_ROOT/lib/cascade/." "$STAGE/lib/cascade/"
fi
write_runtime "$STAGE/lib"
install -o root -g root -m 0644 "$REPO_ROOT/LICENSE" "$STAGE/LICENSE"
install -o root -g root -m 0644 "$REPO_ROOT/docs/NOTICE.md" "$STAGE/NOTICE.md"

if test -e "$INSTALL_ROOT"; then
    OLD_INSTALL="$(dirname "$INSTALL_ROOT")/.sidonia.old.$$"
    test ! -e "$OLD_INSTALL"
    mv -- "$INSTALL_ROOT" "$OLD_INSTALL"
fi
mv -- "$STAGE" "$INSTALL_ROOT"
STAGE=""

install -D -o root -g root -m 0755 "$SOURCE_COMMAND" "$COMMAND_PATH"
if test "$LEGACY_COMMAND_PATH" != "$COMMAND_PATH"; then
    rm -f -- "$LEGACY_COMMAND_PATH"
fi
SUCCESS=1

echo
echo "Sidonia is installed."
echo "Run the theme chooser with:"
echo "  sudo sidonia"

if test "${1:-}" = "--no-apply"; then
    echo "No GRUB theme was changed."
    echo "Choose one later with: sudo sidonia"
    exit 0
fi

export SIDONIA_ASSET_ROOT="$INSTALL_ROOT/themes"
export SIDONIA_INSTALL_ROOT="$INSTALL_ROOT"
export SIDONIA_COMMAND_PATH="$COMMAND_PATH"

if test "$#" -gt 0; then
    "$COMMAND_PATH" set "$@"
    exit 0
fi

if test -t 0 && test -t 1; then
    "$COMMAND_PATH" choose
    exit 0
fi

echo
echo "No interactive terminal was detected, so GRUB was not changed."
echo "Choose a theme with: sudo sidonia"
