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
