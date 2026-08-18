cmake_minimum_required(VERSION 3.19)
project(MultiGramDesktop VERSION 1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Qt WebEngine on Windows requires the MSVC builds of Qt (not MinGW).
find_package(Qt6 REQUIRED COMPONENTS Widgets WebEngineWidgets Svg)
qt_standard_project_setup()

qt_add_executable(MultiGram WIN32
    src/main.cpp
    src/mainwindow.cpp
    src/mainwindow.h
)

qt_add_resources(MultiGram "assets"
    PREFIX "/"
    BASE resources
    FILES resources/icon.svg
)

target_link_libraries(MultiGram PRIVATE
    Qt6::Widgets
    Qt6::WebEngineWidgets
    Qt6::Svg
)
