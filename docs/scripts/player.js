// 播放器核心功能

import * as state from './state.js';
import * as dom from './dom.js';
import { logDebug, showError, showPlayer } from './utils.js';
import { loadLyrics } from './lyrics.js';
import { handleFailedMedia, fetchPlaylistFromNotion } from './api.js';
import { savePlayerState, loadPlayerState, restorePlayback } from './storage.js';
import { preloadAdjacentSongs, createShuffledPlaylist } from './shuffle.js';
// Import the correct search handler
import { handleMainSearch } from './search.js';
// Import repeat mode constants
import { REPEAT_MODE, getCurrentRepeatMode } from './repeatMode.js';

// 初始化播放器
export async function initPlayer() {
    const urlParams = new URLSearchParams(window.location.search);

    dom.searchResultsEl.style.display = 'none';
    dom.playerEl.style.display = 'none';
    dom.loadingEl.style.display = 'block';

    console.log('页面初始化, URL参数:', Object.fromEntries(urlParams));
    
    // 添加 Notion 支持
    const notionTag = urlParams.get('tag');
    const notionSearch = urlParams.get('search');
    
    console.log(`Notion标签: ${notionTag || '无'}, 搜索关键词: ${notionSearch || '无'}`);

    // 处理搜索请求
    if (notionSearch) {
        console.log(`检测到搜索参数: "${notionSearch}", 开始搜索...`);
        try {
            // Use the new search handler
            await handleMainSearch(notionSearch);
            return;
        } catch (error) {
            // handleMainSearch might throw if the API call fails, ensure proper handling
            console.error('Initial search failed:', error);
            // Fallback: try loading default playlist
            try {
                console.log('Search failed, attempting to load default playlist...');
                await loadPlaylistFromNotion(); // Assumes this loads the default list
                // If default load succeeds, we might not need to return immediately,
                // let the rest of initPlayer continue if necessary.
            } catch (e) {
                console.error('Default playlist load failed after search failure:', e);
                showError('无法加载音乐库'); // Show error if fallback also fails
                // Potentially stop further execution if critical
                return;
            }
            // If search failed but default load succeeded, continue initialization if needed
        }
        // If search succeeded, the function returns above.
    }

    // 处理标签过滤请求
    if (notionTag !== null || urlParams.has('notion')) {
        console.log(`加载标签: ${notionTag || '全部'}`);
        try {
            await loadPlaylistFromNotion(notionTag);
            return;
        } catch (error) {
            console.error('按标签加载失败:', error);
            showError(`无法加载标签: ${notionTag}`);
            return;
        }
    }

    // 单曲模式
    const title = urlParams.get('title');
    const artist = urlParams.get('artist');
    const url = urlParams.get('url');
    
    if (title && url) {
        console.log(`加载单曲: ${title} - ${artist || '未知歌手'}`);
        // 单曲模式
        state.updatePlaylist([{
            title: title,
            artist: artist || '未知歌手',
            url: url
        }]);
        
        dom.playlistNameEl.textContent = artist || '单曲播放';
        dom.songCountEl.textContent = '1首歌曲';
        
        // 隐藏导航按钮
        dom.prevButtonEl.style.visibility = 'hidden';
        dom.nextButtonEl.style.visibility = 'hidden';
        
        loadSong(0);
        showPlayer();
        return;
    }
    
    // 默认情况：加载所有歌曲
    console.log('无特定参数，加载全部歌曲');
    try {
        // 检查是否有保存的播放列表标识
        const savedState = loadPlayerState();
        
        // 如果有保存的标签或搜索词，优先使用它们
        if (savedState && savedState.playlistTag) {
            console.log(`恢复上次播放列表(标签): ${savedState.playlistTag}`);
            await loadPlaylistFromNotion(savedState.playlistTag);
        } else if (savedState && savedState.searchTerm) {
            console.log(`恢复上次搜索: ${savedState.searchTerm}`);
            // Use the new search handler to restore search state
            await handleMainSearch(savedState.searchTerm);
        } else {
            // No saved playlist info, load default (all songs)
            console.log('No saved state found, loading default playlist.');
            await loadPlaylistFromNotion();
        }
    } catch (error) {
        console.error('加载所有歌曲失败:', error);
        showError('无法加载音乐库，请稍后再试');
    }
}

// 从 Notion 加载播放列表
export async function loadPlaylistFromNotion(tag = '') {
    try {
        // 显示加载状态
        dom.loadingEl.textContent = '正在从 Notion 加载音乐库...';
        
        const songs = await fetchPlaylistFromNotion(tag);
        
        if (songs.length === 0) {
            throw new Error('播放列表为空');
        }
        
        // 更新状态
        state.updatePlaylist(songs);
        
        // 保存当前播放列表标识
        if (tag) {
            state.updateCurrentPlaylistTag(tag);
        }
        
        // 更新 UI
        dom.playlistNameEl.textContent = tag ? `分类: ${tag}` : 'Notion 音乐库';
        dom.songCountEl.textContent = `${songs.length}首歌曲`;
        
        // 尝试恢复上次播放状态，如果恢复失败则加载第一首歌
        const restored = await restorePlayback();
        if (!restored) {
            loadSong(0);
        }
        
        showPlayer();
        
        // 如果开启了随机播放模式，需要创建随机列表
        if (state.isShuffleMode) {
            const shuffledPlaylist = createShuffledPlaylist();
            state.updateShuffledPlaylist(shuffledPlaylist);
            state.updateCurrentShuffleIndex(0);
        }
        
        console.log(`已从 Notion 加载 ${songs.length} 首歌曲`);
    } catch (error) {
        console.error('从 Notion 加载音乐失败:', error);
        showError('无法从 Notion 加载音乐库');
        throw error;
    }
}

// 加载指定索引的歌曲
export function loadSong(index, autoPlay = true) {
    if (index < 0 || index >= state.playlist.length) {
        console.error(`无效索引: ${index}, 播放列表长度: ${state.playlist.length}`);
        return false;
    }
    
    // 保存当前歌曲的状态以便判断是否真的改变了歌曲
    const previousIndex = state.currentIndex;
    
    const song = state.playlist[index];
    console.log(`加载歌曲: ${song.title}, 索引: ${index}`);
    console.log(`歌曲URL: ${song.url || '无URL'}`);
    console.log(`歌词URL: ${song.lrc || '无歌词'}`);
    
    if (!song.url) {
        console.error(`歌曲 ${song.title} 无URL，尝试下一首`);
        playNext();
        return false;
    }
    
    const title = song.title || '未知歌曲';
    const artist = song.artist || '未知歌手';
    
    // 将歌曲和歌手信息合并显示
    dom.songTitleEl.textContent = `${title} - ${artist}`;
    
    // Add tooltip to show full info when truncated
    dom.songTitleEl.title = `${title} - ${artist}`;
    
    dom.songIndexEl.textContent = `${index + 1}/${state.playlist.length}`;
    
    // 更新歌曲前先清除所有相关状态
    if (previousIndex !== index) {
        // 重置歌词状态
        state.updateLyrics([]);
        state.updateCurrentLyricIndex(-1);
        
        // 重置歌词容器
        const lyricsContainer = document.getElementById('lyrics-container');
        if (lyricsContainer) {
            lyricsContainer.innerHTML = '<div class="lyrics-placeholder">歌词加载中...</div>';
        }
    }
    
    // 设置当前歌曲
    dom.audioPlayerEl.src = song.url;
    state.updateCurrentIndex(index);
    
    // 添加错误处理
    dom.audioPlayerEl.onerror = async function(e) {
        console.error(`音频加载错误:`, e);
        console.error(`错误代码: ${dom.audioPlayerEl.error ? dom.audioPlayerEl.error.code : '未知'}`);
        console.error(`错误信息: ${dom.audioPlayerEl.error ? dom.audioPlayerEl.error.message : '未知'}`);
        
        const newUrl = await handleFailedMedia(song, 'audio');
        if (newUrl) {
            console.log(`获取到新URL: ${newUrl}, 尝试重新加载`);
            dom.audioPlayerEl.src = newUrl;
            dom.audioPlayerEl.play().catch(e => console.log('播放失败:', e));
        } else {
            console.error(`歌曲 ${song.title} 无法播放，尝试下一首`);
            playNext();
        }
    };

    // 更新随机播放相关状态
    if (state.isShuffleMode) {
        const currentShuffleIndex = state.shuffledPlaylist.indexOf(index);
        state.updateCurrentShuffleIndex(currentShuffleIndex !== -1 ? currentShuffleIndex : 0);
        
        if (currentShuffleIndex === -1) {
            // 如果当前歌曲不在随机列表中
            const shuffledPlaylist = createShuffledPlaylist();
            state.updateShuffledPlaylist(shuffledPlaylist);
            state.updateCurrentShuffleIndex(0);
        }
        
        // 更新历史记录
        const newHistory = [...state.playbackHistory, index];
        if (newHistory.length > 10) newHistory.shift();
        state.updatePlaybackHistory(newHistory);
    }
    
    // 预加载相邻歌曲
    preloadAdjacentSongs(index);
    
    // 重置歌词滚动状态
    if (typeof userScrolled !== 'undefined') userScrolled = false;
    
    // 确保在歌曲加载完成后再加载歌词
    if (song.lrc) {
        // 使用延时确保歌曲索引更新后再加载歌词
        setTimeout(() => {
            // 确认当前索引未变化后再加载歌词
            if (state.currentIndex === index) {
                loadLyrics(song.lrc);
            }
        }, 100);
    } else {
        // 无歌词的情况
        const lyricsContainer = document.getElementById('lyrics-container');
        if (lyricsContainer) {
            lyricsContainer.innerHTML = '<div class="lyrics-placeholder">暂无歌词</div>';
        }
    }
    
    // 尝试播放
    if (autoPlay) {
        dom.audioPlayerEl.play().catch(e => console.log('自动播放被浏览器阻止'));
    }
    updateBackButton();
    savePlayerState(); // 保存当前状态
    
    return true;
}

// 播放上一首
export function playPrevious() {
    let prevIndex;
    
    if (state.isShuffleMode && state.playbackHistory.length > 1) {
        // 随机模式下使用历史记录
        const newHistory = [...state.playbackHistory];
        newHistory.pop(); // 移除当前歌曲
        prevIndex = newHistory[newHistory.length - 1]; // 获取上一首
        state.updatePlaybackHistory(newHistory);
        
        // 更新随机索引
        const currentShuffleIndex = state.shuffledPlaylist.indexOf(prevIndex);
        state.updateCurrentShuffleIndex(currentShuffleIndex !== -1 ? currentShuffleIndex : 0);
    } else {
        // 常规模式或无历史记录时
        prevIndex = (state.currentIndex - 1 + state.playlist.length) % state.playlist.length;
    }
    
    // 确保索引有效
    if (prevIndex < 0 || prevIndex >= state.playlist.length) {
        console.error(`无效的上一首索引: ${prevIndex}, 播放列表长度: ${state.playlist.length}`);
        return;
    }
    
    // 彻底清除歌词状态
    state.updateLyrics([]);
    state.updateCurrentLyricIndex(-1);
    
    // 先更新当前索引，确保状态一致
    state.updateCurrentIndex(prevIndex);
    
    // 准备当前歌曲信息
    const song = state.playlist[prevIndex];
    const title = song.title || "未知歌曲";
    const artist = song.artist || "未知歌手";
    
    console.log(`播放上一首: ${title} - ${artist}, 索引: ${prevIndex}`);
    
    // 更新UI
    dom.songTitleEl.textContent = `${title} - ${artist}`;
    dom.songTitleEl.title = `${title} - ${artist}`;
    dom.songIndexEl.textContent = `${prevIndex + 1}/${state.playlist.length}`;
    
    // 重置歌词容器
    const lyricsContainer = document.getElementById('lyrics-container');
    if (lyricsContainer) {
        lyricsContainer.innerHTML = '<div class="lyrics-placeholder">歌词加载中...</div>';
    }
    
    // 保存当前播放状态
    const wasPlaying = !dom.audioPlayerEl.paused;
    
    // 如果前一首歌已预加载并有效
    if (dom.prevAudioPlayerEl.src && dom.prevAudioPlayerEl.readyState >= 2) {
        // 交换音频元素
        dom.audioPlayerEl.src = dom.prevAudioPlayerEl.src;
        
        // 直接加载歌词，不使用延时
        if (song.lrc) {
            loadLyrics(song.lrc);
        } else {
            // 无歌词的情况
            if (lyricsContainer) {
                lyricsContainer.innerHTML = '<div class="lyrics-placeholder">暂无歌词</div>';
            }
        }
        
        // 如果之前是播放状态，继续播放
        if (wasPlaying) {
            dom.audioPlayerEl.play().catch(e => console.log('播放失败:', e));
        }
    } else {
        // 常规加载
        loadSong(prevIndex, wasPlaying);
    }
    
    // 更新预加载
    preloadAdjacentSongs(prevIndex);
    
    // 保存状态
    savePlayerState();
}

// 播放下一首
export function playNext() {
    let nextIndex;
    
    if (state.isShuffleMode) {
        // 随机模式下的下一首
        const newShuffleIndex = (state.currentShuffleIndex + 1) % state.shuffledPlaylist.length;
        nextIndex = state.shuffledPlaylist[newShuffleIndex];
        state.updateCurrentShuffleIndex(newShuffleIndex);
        
        // 记录播放历史
        const newHistory = [...state.playbackHistory, nextIndex];
        if (newHistory.length > 10) newHistory.shift();
        state.updatePlaybackHistory(newHistory);
    } else {
        // 常规模式下的下一首
        nextIndex = (state.currentIndex + 1) % state.playlist.length;
    }
    
    // 确保索引有效
    if (nextIndex < 0 || nextIndex >= state.playlist.length) {
        console.error(`无效的下一首索引: ${nextIndex}, 播放列表长度: ${state.playlist.length}`);
        return;
    }
    
    // 彻底清除歌词状态
    state.updateLyrics([]);
    state.updateCurrentLyricIndex(-1);
    
    // 先更新当前索引，确保状态一致
    state.updateCurrentIndex(nextIndex);
    
    // 准备当前歌曲信息
    const song = state.playlist[nextIndex];
    const title = song.title || "未知歌曲";
    const artist = song.artist || "未知歌手";
    
    console.log(`播放下一首: ${title} - ${artist}, 索引: ${nextIndex}`);
    
    // 更新UI
    dom.songTitleEl.textContent = `${title} - ${artist}`;
    dom.songTitleEl.title = `${title} - ${artist}`;
    dom.songIndexEl.textContent = `${nextIndex + 1}/${state.playlist.length}`;
    
    // 重置歌词容器
    const lyricsContainer = document.getElementById('lyrics-container');
    if (lyricsContainer) {
        lyricsContainer.innerHTML = '<div class="lyrics-placeholder">歌词加载中...</div>';
    }
    
    // 如果下一首歌已预加载并有效
    if (dom.nextAudioPlayerEl.src && dom.nextAudioPlayerEl.readyState >= 2) {
        // 交换音频元素
        dom.audioPlayerEl.src = dom.nextAudioPlayerEl.src;
        
        // 直接加载歌词，不使用延时
        if (song.lrc) {
            loadLyrics(song.lrc);
        } else {
            // 无歌词的情况
            if (lyricsContainer) {
                lyricsContainer.innerHTML = '<div class="lyrics-placeholder">暂无歌词</div>';
            }
        }
        
        dom.audioPlayerEl.play().catch(e => {
            console.warn('自动播放被阻止，尝试静音播放', e);
            // 如果播放被阻止，尝试静音播放，然后恢复音量
            dom.audioPlayerEl.muted = true;
            dom.audioPlayerEl.play().then(() => {
                dom.audioPlayerEl.muted = false;
            }).catch(err => {
                console.error('即使静音也无法自动播放:', err);
            });
        });
    } else {
        // 常规加载
        loadSong(nextIndex, true);
    }
    
    // 更新预加载
    preloadAdjacentSongs(nextIndex);
    
    // 保存状态
    savePlayerState();
}

// 根据情况显示或隐藏返回按钮
export function updateBackButton() {
    // 仅当是搜索结果时显示返回按钮
    if (dom.playlistNameEl.textContent.startsWith('搜索:')) {
        dom.backToSearchButtonEl.style.display = 'inline-block';
    } else {
        dom.backToSearchButtonEl.style.display = 'none';
    }
}
