// macOS Tahoe only gives a window the larger corner radius native apps like System Settings
// have when the window has a toolbar, and no Electron titleBarStyle adds one anymore. Web
// contents still receive clicks under the empty toolbar. Fullscreen windows have no corners,
// so the toolbar is hidden there instead of showing as a blank strip above the page.
#import <AppKit/AppKit.h>
#include <node_api.h>

static napi_value AttachEmptyToolbar(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  void *handle = NULL;
  size_t length = 0;
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 1 || napi_get_buffer_info(env, argv[0], &handle, &length) != napi_ok ||
      length < sizeof(void *)) {
    napi_throw_type_error(env, NULL, "Expected the Buffer from getNativeWindowHandle()");
    return NULL;
  }

  NSView *view = (__bridge NSView *)(*(void **)handle);
  NSWindow *window = view.window;
  if (window != nil && window.toolbar == nil) {
    window.toolbar = [[NSToolbar alloc] initWithIdentifier:@"messenger-window"];
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center addObserverForName:NSWindowWillEnterFullScreenNotification
                        object:window
                         queue:nil
                    usingBlock:^(NSNotification *note) {
                      ((NSWindow *)note.object).toolbar.visible = NO;
                    }];
    [center addObserverForName:NSWindowWillExitFullScreenNotification
                        object:window
                         queue:nil
                    usingBlock:^(NSNotification *note) {
                      ((NSWindow *)note.object).toolbar.visible = YES;
                    }];
  }
  return NULL;
}

NAPI_MODULE_INIT() {
  napi_value attachEmptyToolbar;
  napi_create_function(env, "attachEmptyToolbar", NAPI_AUTO_LENGTH, AttachEmptyToolbar, NULL,
                       &attachEmptyToolbar);
  napi_set_named_property(env, exports, "attachEmptyToolbar", attachEmptyToolbar);
  return exports;
}
