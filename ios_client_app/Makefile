TARGET := iphone:clang:latest:15.0
ARCHS := arm64
DEBUG := 0

include $(THEOS)/makefiles/common.mk

APPLICATION_NAME = iControlApp

iControlApp_FILES = iControlApp/AppDelegate.swift iControlApp/ViewController.swift iControlApp/FloatingWindow.swift iControlApp/TouchSimulator.swift iControlApp/WebSocketClient.swift iControlApp/LocalServer.swift iControlApp/WebAssets.swift
iControlApp_FRAMEWORKS = UIKit CoreGraphics
iControlApp_CODESIGN_FLAGS = -Sentitlements.plist

include $(THEOS_MAKE_PATH)/application.mk
