sidonia_motion.module: $(SIDONIA_SOURCE) $(dir $(SIDONIA_SOURCE))list-2.14.h
	$(CC) $(DEFS) $(DEFAULT_INCLUDES) $(AM_CPPFLAGS) $(CPPFLAGS_MODULE) $(CPPFLAGS) $(AM_CFLAGS) $(CFLAGS_MODULE) $(CFLAGS) -ffile-prefix-map=$(dir $(SIDONIA_SOURCE))= -c $< -o $@

sidonia_motion.mod: sidonia_motion.module genmod.sh build-grub-module-verifier
	printf 'sidonia_motion: gfxmenu\n' > sidonia-moddep.lst
	sh genmod.sh sidonia-moddep.lst sidonia_motion.module build-grub-module-verifier $@
