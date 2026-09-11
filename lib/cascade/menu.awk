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
